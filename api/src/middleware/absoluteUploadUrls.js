// Expand root-relative upload paths into absolute URLs on the way out.
//
// services/storage.js stores locally-served uploads as "/uploads/<file>" and
// never as an absolute URL, so no hostname is persisted in the database. That
// was the bug this middleware exists to make impossible: the dev machine's LAN
// IP / .local hostname used to be written into User.avatarUrl, Business photo
// arrays, message attachments and so on, which meant a row uploaded on one
// network was a dead link on the next one.
//
// Clients still need absolute URLs, so we rebuild them here against the host
// the request actually arrived on. The same row then resolves correctly from
// the simulator (localhost), a phone on the LAN (the .local name), and the
// deployed API — with no migration and no client change. S3 URLs are already
// absolute and pass through untouched.
//
// PUBLIC_BASE_URL overrides the request host when set — useful when the API
// sits behind a proxy whose Host header isn't reachable by clients.

// Conservative: only paths we ourselves mint under /uploads/. Anything else,
// including absolute http(s) URLs, is left exactly as-is.
const UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9._-]+$/;

function baseUrlFor(req) {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Copy-on-write: an unchanged subtree is returned by reference. Response
// bodies sometimes include module-level constants (the questionnaire bundle
// config, for one), and mutating those in place would corrupt them for every
// later request.
function expand(value, base) {
  if (typeof value === 'string') {
    return UPLOAD_PATH.test(value) ? `${base}${value}` : value;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = expand(item, base);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }

  // Plain objects only — Date, Buffer, Prisma Decimal etc. pass through whole.
  if (isPlainObject(value)) {
    let changed = false;
    const out = {};
    for (const key of Object.keys(value)) {
      const next = expand(value[key], base);
      if (next !== value[key]) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }

  return value;
}

function absoluteUploadUrls(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(expand(body, baseUrlFor(req)));
  next();
}

module.exports = absoluteUploadUrls;
module.exports.expand = expand;
