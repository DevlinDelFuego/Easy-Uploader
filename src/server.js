require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const path = require('path');
const { migrate, seedAdmin } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
    },
  },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
  name: 'admin.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/admin', require('./routes/admin'));
app.use('/admin', require('./routes/adminShares'));
app.use('/', require('./routes/share'));

app.get('/', (req, res) => res.redirect('/admin'));

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
