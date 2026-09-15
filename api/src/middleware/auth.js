const jwt = require('jsonwebtoken');
const db = require('../services/db');

// Invalid credentials are anonymous; database failures propagate to the error
// handler instead of being mistaken for a signed-out user.
async function sessionUser(header) {
  if (!header?.startsWith('Bearer ')) return null;
  let payload;
  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof payload.id !== 'string' || !Number.isInteger(payload.sessionVersion ?? 0)) return null;
  } catch {
    return null;
  }
  const user = await db.user.findUnique({
    where: { id: payload.id }, select: { id: true, role: true, sessionVersion: true },
  });
  // Legacy tokens remain valid until the first credential rotation.
  return user && user.sessionVersion === (payload.sessionVersion ?? 0) ? user : null;
}

async function authMiddleware(req, res, next) {
  try {
    req.user = await sessionUser(req.headers.authorization);
    if (!req.user) {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole, sessionUser };
