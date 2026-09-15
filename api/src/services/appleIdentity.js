const jwt = require('jsonwebtoken');
const { createPublicKey } = require('crypto');

function verifyAppleIdentity(token, jwk) {
  const audience = process.env.APPLE_BUNDLE_ID || process.env.APNS_BUNDLE_ID || 'app.renovateconnect';
  return jwt.verify(token, createPublicKey({ key: jwk, format: 'jwk' }), {
    algorithms: ['RS256'],
    issuer: 'https://appleid.apple.com',
    audience,
  });
}

module.exports = { verifyAppleIdentity };
