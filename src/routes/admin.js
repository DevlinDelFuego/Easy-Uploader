const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const path = require('path');
const { db } = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.get('/', (req, res) => res.redirect('/admin/login'));

router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin/dashboard');
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'login.html'));
});

router.post('/login', authLimiter, [
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.redirect('/admin/login?error=1');

  const { username, password } = req.body;
  const storedUsername = db.prepare('SELECT value FROM config WHERE key = ?').get('admin_username');
  const storedHash = db.prepare('SELECT value FROM config WHERE key = ?').get('admin_password_hash');

  if (!storedUsername || !storedHash) return res.redirect('/admin/login?error=1');

  const usernameMatch = username === storedUsername.value;
  const passwordMatch = await bcrypt.compare(password, storedHash.value);

  if (!usernameMatch || !passwordMatch) return res.redirect('/admin/login?error=1');

  req.session.regenerate(err => {
    if (err) return res.redirect('/admin/login?error=1');
    req.session.isAdmin = true;
    res.redirect('/admin/dashboard');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.get('/dashboard', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'dashboard.html'));
});

module.exports = router;
