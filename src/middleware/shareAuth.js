const { db } = require('../db');

function requireShare(req, res, next) {
  const { slug } = req.params;
  if (!req.session.shareAccess || !req.session.shareAccess[slug]) {
    return res.redirect(`/s/${encodeURIComponent(slug)}`);
  }

  const share = db.prepare('SELECT active, expires_at FROM shares WHERE slug = ?').get(slug);
  if (!share || !share.active) return res.redirect(`/s/${encodeURIComponent(slug)}?error=unavailable`);
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return res.redirect(`/s/${encodeURIComponent(slug)}?error=expired`);
  }

  next();
}

module.exports = { requireShare };
