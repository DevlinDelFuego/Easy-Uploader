require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const path = require('path');
const { db, migrate, seedAdmin } = require('./db');

class SQLiteStore extends session.Store {
  constructor() {
    super();
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      sid     TEXT PRIMARY KEY,
      data    TEXT NOT NULL,
      expires INTEGER NOT NULL
    )`);
    setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 15 * 60 * 1000).unref();
  }
  get(sid, cb) {
    const row = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?').get(sid);
    if (!row || row.expires < Date.now()) return cb(null, null);
    try { cb(null, JSON.parse(row.data)); } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
    try { db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expires); cb(null); } catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    cb(null);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', process.env.TRUST_PROXY === 'true');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://static.cloudflareinsights.com'],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  hsts: false,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
  name: 'admin.sid',
  store: new SQLiteStore(),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/icon.png', (req, res) => res.sendFile(path.join(__dirname, '..', 'icon.png')));
app.get('/admin', (req, res) => res.redirect('/admin/login'));
app.use('/admin', require('./routes/admin'));
app.use('/admin', require('./routes/adminShares'));
app.use('/', require('./routes/share'));

app.get('/', (req, res) => res.redirect('/admin/login'));

app.use((err, req, res, next) => {
  console.error(err.stack);
  if (res.headersSent) return next(err);
  if (req.accepts('json')) return res.status(500).json({ error: 'Internal server error' });
  res.status(500).send('Internal server error');
});

async function start() {
  migrate();
  await seedAdmin();
  app.listen(PORT, () => console.log(`Easy Uploader running on port ${PORT}`));
}

start();
