const { createPublicKey } = require('crypto');
const https = require('https');
const jwt = require('jsonwebtoken');

// Verify a Google ID token (Sign in with Google). Mirrors the Apple flow in
// routes/auth.js: fetch Google's public JWKS, find the signing key by kid, and
// verify signature + issuer + audience. The audience allowlist comes from
// GOOGLE_CLIENT_IDS (comma-separated OAuth client ids) — without it any Google
// app's token would authenticate against our API, so configuration is required.

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function fetchGoogleKeys() {
  return new Promise((resolve, reject) => {
    https.get(GOOGLE_CERTS_URL, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data).keys); } catch (err) { reject(err); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function allowedClientIds() {
  return (process.env.GOOGLE_CLIENT_IDS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

function isConfigured() {
  return allowedClientIds().length > 0;
}

// Resolves the verified token payload, or throws (caller maps to 401). Only
// claims out of the verified token are trusted — never client-supplied fields.
async function verifyGoogleIdToken(idToken, { fetchKeys = fetchGoogleKeys } = {}) {
  const [headerB64] = String(idToken).split('.');
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

  const keys = await fetchKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Google public key not found');

  const payload = jwt.verify(idToken, createPublicKey({ key: jwk, format: 'jwk' }), {
    algorithms: ['RS256'],
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: allowedClientIds(),
  });

  // Only accept Google-verified addresses — an unverified email could be
  // claimed by anyone and would let them shadow an existing account.
  if (!payload.email || payload.email_verified !== true) {
    throw new Error('Google account email is missing or unverified');
  }
  return payload;
}

module.exports = { verifyGoogleIdToken, isConfigured, fetchGoogleKeys };
