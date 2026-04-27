const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { db } = require('../db');
const { requireShare } = require('../middleware/shareAuth');
const FileType = require('file-type');
const { authLimiter, uploadLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const UPLOADS_BASE = path.resolve(
  process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads')
);

const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB) || 500) * 1024 * 1024;

const GUEST_COOKIE = 'guest_token';
const GUEST_COOKIE_MAX_AGE = 10 * 24 * 60 * 60 * 1000;

const BLOCKED_MIME = new Set([
  'application/x-executable', 'application/x-msdownload', 'application/x-msdos-program',
  'application/x-sh', 'application/x-bat', 'application/x-csh', 'application/x-perl',
  'application/x-php', 'text/x-php', 'application/x-httpd-php',
  'application/javascript', 'text/javascript',
  'application/x-python', 'text/x-python',
  'application/x-msi', 'application/x-ole-storage',
  'application/x-powershell', 'application/vnd.ms-powerpoint.addin',
  'application/x-vbscript', 'text/vbscript',
  'application/java-archive', 'application/x-java-archive',
]);

const BLOCKED_EXT = new Set([
  '.exe', '.msi', '.dll', '.bat', '.cmd', '.com', '.scr', '.pif', '.vbs', '.vbe',
  '.js', '.jse', '.ws', '.wsf', '.wsc', '.wsh', '.ps1', '.ps2', '.psc1', '.psc2',
  '.sh', '.bash', '.zsh', '.fish', '.csh', '.ksh',
  '.php', '.php3', '.php4', '.php5', '.phtml',
  '.py', '.pyc', '.pyo', '.pyw',
  '.rb', '.pl', '.cgi',
  '.jar', '.class', '.war', '.ear',
  '.app', '.pkg', '.dmg', '.deb', '.rpm',
  '.reg', '.inf', '.ins', '.isu',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_BASE, req.params.slug);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const raw = path.extname(file.originalname).toLowerCase();
    const ext = raw.replace(/[^a-z0-9.]/g, '').slice(0, 12);
    cb(null, uuidv4() + ext);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.has(ext)) return cb(new Error(`File type not allowed: ${ext}`));
    if (BLOCKED_MIME.has(file.mimetype)) return cb(new Error(`File type not allowed: ${file.mimetype}`));
    cb(null, true);
  },
  limits: { fileSize: MAX_FILE_SIZE, files: 20 },
});

function getShare(slug) {
  return db.prepare('SELECT * FROM shares WHERE slug = ?').get(slug);
}

function shareStatus(share) {
  if (!share) return 'not_found';
  if (!share.active) return 'inactive';
  if (share.expires_at && new Date(share.expires_at) < new Date()) return 'expired';
  return 'ok';
}

// Public share info (name + status only — no password)
router.get('/s/:slug/info', (req, res) => {
  const share = getShare(req.params.slug);
  const status = shareStatus(share);
  if (status === 'not_found') return res.status(404).json({ error: 'Share not found' });
  res.json({ name: share.name, slug: share.slug, status });
});

// Auth page
router.get('/s/:slug', (req, res) => {
  const share = getShare(req.params.slug);
  if (!share) return res.status(404).sendFile(path.join(__dirname, '..', 'public', 'upload', '404.html'));
  if (req.session.shareAccess && req.session.shareAccess[req.params.slug]) {
    return res.redirect(`/s/${req.params.slug}/upload`);
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'upload', 'auth.html'));
});

// Auth submit
router.post('/s/:slug/auth', authLimiter, [body('password').notEmpty()], async (req, res) => {
  const { slug } = req.params;
  const share = getShare(slug);
  const status = shareStatus(share);

  if (status !== 'ok') return res.redirect(`/s/${slug}?error=${status}`);

  const match = await bcrypt.compare(req.body.password || '', share.password_hash);
  if (!match) return res.redirect(`/s/${slug}?error=1`);

  req.session.regenerate(err => {
    if (err) return res.redirect(`/s/${slug}?error=1`);
    req.session.shareAccess = { [slug]: true };

    if (!req.cookies[GUEST_COOKIE]) {
      res.cookie(GUEST_COOKIE, uuidv4(), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: GUEST_COOKIE_MAX_AGE,
      });
    }

    res.redirect(`/s/${slug}/upload`);
  });
});

// Upload page
router.get('/s/:slug/upload', requireShare, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'upload', 'upload.html'));
});

// File upload
router.post('/s/:slug/upload', requireShare, uploadLimiter, (req, res, next) => {
  upload.array('files', 20)(req, res, err => {
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `File too large. Max size is ${process.env.MAX_FILE_SIZE_MB || 500} MB.`
        : err.message;
      return res.status(413).json({ error: msg });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, [
  body('submitted_by').trim().notEmpty().withMessage('Your name is required'),
  body('comment').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    (req.files || []).forEach(f => fs.unlink(f.path, () => {}));
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files received.' });
  }

  // Magic byte validation — check actual file content, not just the declared MIME type
  for (const file of req.files) {
    const detected = await FileType.fromFile(file.path);
    if (detected && BLOCKED_MIME.has(detected.mime)) {
      req.files.forEach(f => fs.unlink(f.path, () => {}));
      return res.status(400).json({ error: `File type not allowed: ${detected.mime}` });
    }
  }

  const { slug } = req.params;
  const share = db.prepare('SELECT id FROM shares WHERE slug = ?').get(slug);
  const guestToken = req.cookies[GUEST_COOKIE] || null;
  const submittedBy = req.body.submitted_by.trim();
  const comment = (req.body.comment || '').trim() || null;

  const insert = db.prepare(`
    INSERT INTO uploads (share_id, guest_token, original_name, stored_name, mime_type, size_bytes, submitted_by, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const uploaded = req.files.map(file => {
    const result = insert.run(share.id, guestToken, file.originalname, file.filename, file.mimetype, file.size, submittedBy, comment);
    return { id: result.lastInsertRowid, name: file.originalname, stored: file.filename, size: file.size, mime: file.mimetype };
  });

  res.json({ uploaded });
});

// Guest's uploads for this share
router.get('/s/:slug/my-uploads', requireShare, (req, res) => {
  const guestToken = req.cookies[GUEST_COOKIE];
  if (!guestToken) return res.json([]);

  const share = db.prepare('SELECT id FROM shares WHERE slug = ?').get(req.params.slug);
  if (!share) return res.json([]);

  const uploads = db.prepare(`
    SELECT id, original_name, stored_name, mime_type, size_bytes, submitted_by, comment, uploaded_at
    FROM uploads WHERE share_id = ? AND guest_token = ?
    ORDER BY uploaded_at DESC
  `).all(share.id, guestToken);

  res.json(uploads);
});

// Serve uploaded files (share-authenticated)
router.get('/s/:slug/files/:filename', requireShare, (req, res) => {
  const { slug, filename } = req.params;
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,12}$/.test(filename)) return res.status(400).end();
  const filePath = path.resolve(UPLOADS_BASE, slug, filename);
  const rel = path.relative(UPLOADS_BASE, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return res.status(400).end();
  res.sendFile(filePath);
});

module.exports = router;
