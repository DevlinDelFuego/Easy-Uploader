const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const path = require('path');
const fsp = require('fs/promises');
const { db } = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

const UPLOADS_BASE = path.resolve(
  process.env.UPLOADS_PATH || path.join(__dirname, '..', '..', 'uploads')
);

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

router.get('/shares', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'shares.html'));
});

router.get('/api/stats', requireAdmin, (req, res) => {
  const totalShares = db.prepare('SELECT COUNT(*) as n FROM shares').get().n;
  const activeShares = db.prepare('SELECT COUNT(*) as n FROM shares WHERE active = 1').get().n;
  const totalUploads = db.prepare('SELECT COUNT(*) as n FROM uploads').get().n;
  res.json({ totalShares, activeShares, totalUploads });
});

router.get('/api/shares', requireAdmin, (req, res) => {
  const shares = db.prepare(`
    SELECT s.id, s.name, s.slug, s.created_at, s.expires_at, s.active,
           COUNT(u.id) AS file_count
    FROM shares s
    LEFT JOIN uploads u ON u.share_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).all();
  res.json(shares);
});

router.post('/api/shares', requireAdmin, [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('slug').trim().matches(SLUG_RE).withMessage('Slug must be lowercase letters, numbers, and hyphens'),
  body('password').notEmpty().withMessage('Password is required'),
  body('expires_at').optional({ checkFalsy: true }).isISO8601().withMessage('Invalid expiry date'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { name, slug, password, expires_at } = req.body;

  if (db.prepare('SELECT id FROM shares WHERE slug = ?').get(slug)) {
    return res.status(409).json({ error: 'That URL slug is already in use' });
  }

  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare(
    'INSERT INTO shares (name, slug, password_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).run(name, slug, hash, expires_at || null);

  res.json({ id: result.lastInsertRowid });
});

router.patch('/api/shares/:id', requireAdmin, [
  param('id').isInt({ min: 1 }),
  body('name').optional().trim().notEmpty(),
  body('slug').optional().trim().matches(SLUG_RE),
  body('password').optional(),
  body('expires_at').optional({ checkFalsy: true }),
  body('active').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const { id } = req.params;
  const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(id);
  if (!share) return res.status(404).json({ error: 'Share not found' });

  const { name, slug, password, expires_at, active } = req.body;

  if (slug && slug !== share.slug) {
    if (db.prepare('SELECT id FROM shares WHERE slug = ? AND id != ?').get(slug, id)) {
      return res.status(409).json({ error: 'That URL slug is already in use' });
    }
  }

  const newHash = password ? await bcrypt.hash(password, 12) : share.password_hash;

  db.prepare(`
    UPDATE shares SET name = ?, slug = ?, password_hash = ?, expires_at = ?, active = ?
    WHERE id = ?
  `).run(
    name ?? share.name,
    slug ?? share.slug,
    newHash,
    expires_at !== undefined ? (expires_at || null) : share.expires_at,
    active !== undefined ? (active ? 1 : 0) : share.active,
    id
  );

  res.json({ ok: true });
});

router.delete('/api/shares/:id', requireAdmin, param('id').isInt({ min: 1 }), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid id' });

  const { id } = req.params;
  const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(id);
  if (!share) return res.status(404).json({ error: 'Share not found' });

  const shareDir = path.join(UPLOADS_BASE, share.slug);
  await fsp.rm(shareDir, { recursive: true, force: true }).catch(() => {});

  db.prepare('DELETE FROM uploads WHERE share_id = ?').run(id);
  db.prepare('DELETE FROM shares WHERE id = ?').run(id);

  res.json({ ok: true });
});

// All files across all shares (optional ?share_id= filter)
router.get('/api/files', requireAdmin, (req, res) => {
  const { share_id } = req.query;
  let sql = `
    SELECT u.id, u.original_name, u.stored_name, u.mime_type, u.size_bytes,
           u.submitted_by, u.comment, u.uploaded_at,
           s.name AS share_name, s.slug AS share_slug
    FROM uploads u
    JOIN shares s ON s.id = u.share_id
  `;
  const params = [];
  if (share_id) { sql += ' WHERE u.share_id = ?'; params.push(share_id); }
  sql += ' ORDER BY u.uploaded_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Delete a single file
router.delete('/api/files/:id', requireAdmin, param('id').isInt({ min: 1 }), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid id' });

  const file = db.prepare(`
    SELECT u.*, s.slug FROM uploads u JOIN shares s ON s.id = u.share_id WHERE u.id = ?
  `).get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  await fsp.unlink(path.join(UPLOADS_BASE, file.slug, file.stored_name)).catch(() => {});
  db.prepare('DELETE FROM uploads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Serve an uploaded file for admin viewing
router.get('/uploads/:slug/:filename', requireAdmin, (req, res) => {
  const { slug, filename } = req.params;
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,12}$/.test(filename)) return res.status(400).end();
  const filePath = path.resolve(UPLOADS_BASE, slug, filename);
  const rel = path.relative(UPLOADS_BASE, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return res.status(400).end();
  res.sendFile(filePath);
});

// All Files page
router.get('/files', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'files.html'));
});

module.exports = router;
