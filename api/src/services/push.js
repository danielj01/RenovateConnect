const http2 = require('http2');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { allowsType } = require('./notificationPrefs');

// APNs (Apple Push Notification service) over HTTP/2 with token-based auth.
// We sign a provider JWT with the .p8 key (ES256) and reuse it for ~50 min.
//
// This module is intentionally dependency-free: it only uses Node's built-in
// `http2` and the `jsonwebtoken` package already in the project. If APNs is not
// configured (no key in the environment) every call becomes a safe no-op, so
// triggers can fire-and-forget without breaking the request that spawned them.

// Read at call-time (not destructured at module load) so configuration can be
// toggled per-environment and exercised in tests.
function apnsConfig() {
  return {
    keyId: process.env.APNS_KEY_ID,
    teamId: process.env.APNS_TEAM_ID,
    bundleId: process.env.APNS_BUNDLE_ID,
    key: process.env.APNS_KEY, // contents of the AuthKey_XXXX.p8 (literal "\n" allowed)
    production: process.env.APNS_PRODUCTION === 'true',
  };
}

function isConfigured() {
  const { keyId, teamId, bundleId, key } = apnsConfig();
  return Boolean(keyId && teamId && bundleId && key);
}

function apnsHost() {
  return apnsConfig().production
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';
}

let _warned = false;
function warnOnce() {
  if (!_warned) {
    console.log('[push] APNs not configured (APNS_KEY/KEY_ID/TEAM_ID/BUNDLE_ID) — skipping push delivery.');
    _warned = true;
  }
}

// --- Provider token (cached) ---------------------------------------------
let _jwt = null;
let _jwtIssuedAt = 0;
function providerToken() {
  const now = Date.now();
  // Apple recommends reusing the token for 20–60 minutes; refresh at 50.
  if (_jwt && now - _jwtIssuedAt < 50 * 60 * 1000) return _jwt;
  const { keyId, teamId, key: rawKey } = apnsConfig();
  const key = rawKey.replace(/\\n/g, '\n');
  _jwt = jwt.sign(
    { iss: teamId, iat: Math.floor(now / 1000) },
    key,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: keyId } }
  );
  _jwtIssuedAt = now;
  return _jwt;
}

// --- Payload --------------------------------------------------------------
function buildPayload({ title, body, badge, data }) {
  const aps = { alert: { title, body }, sound: 'default' };
  if (badge != null) aps.badge = badge;
  return { aps, ...(data || {}) };
}

// --- Single-token delivery ------------------------------------------------
// Resolves { ok, status, reason } and never rejects.
function deliverToToken(deviceToken, payload) {
  return new Promise((resolve) => {
    let client;
    try {
      client = http2.connect(apnsHost());
    } catch {
      return resolve({ ok: false, status: 0 });
    }
    client.on('error', () => resolve({ ok: false, status: 0 }));

    const body = JSON.stringify(payload);
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken()}`,
      'apns-topic': apnsConfig().bundleId,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });

    let status = 0;
    let raw = '';
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { client.close(); } catch { /* noop */ }
      let reason;
      try { reason = JSON.parse(raw || '{}').reason; } catch { /* noop */ }
      resolve({ ok: status === 200, status, reason });
    });
    req.on('error', () => {
      try { client.close(); } catch { /* noop */ }
      resolve({ ok: false, status: 0 });
    });
    req.end(body);
  });
}

// A token is permanently dead (should be pruned) for these APNs signals.
function isDeadToken({ status, reason }) {
  return status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered';
}

// --- Public API -----------------------------------------------------------
// Send a notification to every device registered to a user. Looks up the
// user's master push switch (`pushEnabled`) plus the per-type opt-out (when the
// caller tags the notification with a `type`) and prunes tokens Apple rejects.
async function sendPush(userId, notification) {
  if (!isConfigured()) {
    warnOnce();
    return { skipped: true };
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { pushEnabled: true },
  });
  if (!user || user.pushEnabled === false) return { skipped: true };

  // Per-category opt-out (gates push the same way it gates the activity feed).
  if (notification?.type && !(await allowsType(userId, notification.type))) {
    return { skipped: true };
  }

  const tokens = await db.deviceToken.findMany({ where: { userId } });
  if (tokens.length === 0) return { sent: 0 };

  const payload = buildPayload(notification);
  const dead = [];
  let sent = 0;

  await Promise.all(tokens.map(async (t) => {
    const result = await deliverToToken(t.token, payload);
    if (result.ok) sent += 1;
    else if (isDeadToken(result)) dead.push(t.token);
  }));

  if (dead.length) {
    await db.deviceToken.deleteMany({ where: { token: { in: dead } } }).catch(() => {});
  }

  return { sent, pruned: dead.length };
}

module.exports = { sendPush, isConfigured, buildPayload, isDeadToken };
