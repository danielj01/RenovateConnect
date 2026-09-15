const jwt = require('jsonwebtoken');
const { generateKeyPairSync } = require('crypto');
const { verifyAppleIdentity } = require('../src/services/appleIdentity');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
const token = (audience, issuer = 'https://appleid.apple.com') => jwt.sign(
  { sub: 'test-user' }, privateKey, { algorithm: 'RS256', audience, issuer, expiresIn: '5m' }
);
test('pins the real app audience even when env values are absent', () => {
  delete process.env.APPLE_BUNDLE_ID;
  delete process.env.APNS_BUNDLE_ID;
  expect(verifyAppleIdentity(token('app.renovateconnect'), jwk).sub).toBe('test-user');
  expect(() => verifyAppleIdentity(token('other.app'), jwk)).toThrow(/audience/);
});
test('honors the configured audience and rejects wrong issuers', () => {
  process.env.APPLE_BUNDLE_ID = 'configured.app';
  expect(verifyAppleIdentity(token('configured.app'), jwk).sub).toBe('test-user');
  expect(() => verifyAppleIdentity(token('app.renovateconnect'), jwk)).toThrow(/audience/);
  expect(() => verifyAppleIdentity(token('configured.app', 'https://example.test'), jwk)).toThrow(/issuer/);
});
