const { generateKeyPairSync } = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const { verifyGoogleIdToken } = require('../src/services/googleAuth');
const { db, resetDb } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

// A local RSA pair standing in for Google's signing keys; fetchKeys is
// injected so no network is touched.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
const fetchKeys = async () => [jwk];

const CLIENT_ID = 'test-ios-client.apps.googleusercontent.com';

function googleToken(claims = {}, { kid = KID, key = privateKey } = {}) {
  return jwt.sign({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-sub-123',
    email: 'gina@example.com',
    email_verified: true,
    name: 'Gina Googleuser',
    ...claims,
  }, key, { algorithm: 'RS256', keyid: kid, expiresIn: '5m' });
}

describe('verifyGoogleIdToken', () => {
  beforeEach(() => { process.env.GOOGLE_CLIENT_IDS = CLIENT_ID; });
  afterEach(() => { delete process.env.GOOGLE_CLIENT_IDS; });

  test('accepts a valid token and returns its payload', async () => {
    const payload = await verifyGoogleIdToken(googleToken(), { fetchKeys });
    expect(payload.email).toBe('gina@example.com');
    expect(payload.name).toBe('Gina Googleuser');
  });

  test('rejects a token for a different audience', async () => {
    const token = googleToken({ aud: 'someone-elses-app.apps.googleusercontent.com' });
    await expect(verifyGoogleIdToken(token, { fetchKeys })).rejects.toThrow();
  });

  test('rejects an unverified email', async () => {
    const token = googleToken({ email_verified: false });
    await expect(verifyGoogleIdToken(token, { fetchKeys })).rejects.toThrow(/unverified/);
  });

  test('rejects a wrong issuer', async () => {
    const token = googleToken({ iss: 'https://evil.example.com' });
    await expect(verifyGoogleIdToken(token, { fetchKeys })).rejects.toThrow();
  });

  test('rejects an unknown signing key', async () => {
    const token = googleToken({}, { kid: 'unknown-kid' });
    await expect(verifyGoogleIdToken(token, { fetchKeys })).rejects.toThrow(/public key/);
  });
});

describe('POST /auth/google', () => {
  test('returns 503 when GOOGLE_CLIENT_IDS is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_IDS;
    const res = await request(app).post('/auth/google').send({ idToken: 'x'.repeat(40) });
    expect(res.status).toBe(503);
  });

  test('rejects a garbage token with 401', async () => {
    process.env.GOOGLE_CLIENT_IDS = CLIENT_ID;
    const res = await request(app).post('/auth/google').send({ idToken: 'not-a-jwt' });
    expect(res.status).toBe(401);
    delete process.env.GOOGLE_CLIENT_IDS;
  });

  test('rejects unexpected fields', async () => {
    process.env.GOOGLE_CLIENT_IDS = CLIENT_ID;
    const res = await request(app).post('/auth/google').send({ idToken: 'x', extra: 1 });
    expect(res.status).toBe(400);
    delete process.env.GOOGLE_CLIENT_IDS;
  });
});
