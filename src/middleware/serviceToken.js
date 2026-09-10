/**
 * Require X-Service-Token matching USAGE_SERVICE_TOKEN or ADMIN_SERVICE_TOKEN.
 * Same secret as auth-content SERVICE_TOKEN in production.
 */
function requireServiceToken(req, res, next) {
  const expected =
    (process.env.ADMIN_SERVICE_TOKEN || process.env.USAGE_SERVICE_TOKEN || '').trim();
  if (!expected) {
    return res.status(503).json({
      error: 'ADMIN_SERVICE_TOKEN / USAGE_SERVICE_TOKEN not configured',
      code: 'CONFIG',
    });
  }
  const token = (req.headers['x-service-token'] || '').toString();
  if (token !== expected) {
    return res.status(401).json({ error: 'Invalid service token', code: 'UNAUTHORIZED' });
  }
  next();
}

module.exports = { requireServiceToken };
