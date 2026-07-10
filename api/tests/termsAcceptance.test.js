const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, tokenFor } = require('./helpers');
const { CURRENT_TERMS_VERSION } = require('../src/services/legal');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

const base = {
  password: 'sup3rsecret!',
  name: 'Click Wrap',
  role: 'CLIENT',
};

describe('Clickwrap: Terms acceptance at registration', () => {
  test('registration requires acceptedTerms === true', async () => {
    const noFlag = await request(app).post('/auth/register')
      .send({ ...base, email: `a_${Date.now()}@t.com` });
    expect(noFlag.status).toBe(400);

    const falseFlag = await request(app).post('/auth/register')
      .send({ ...base, email: `b_${Date.now()}@t.com`, acceptedTerms: false });
    expect(falseFlag.status).toBe(400);
  });

  test('a valid registration records the timestamp + version agreed to', async () => {
    const email = `c_${Date.now()}@t.com`;
    const res = await request(app).post('/auth/register')
      .send({ ...base, email, acceptedTerms: true });
    expect(res.status).toBe(201);

    const user = await db.user.findUnique({ where: { email } });
    expect(user.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(user.termsAcceptedAt).toBeInstanceOf(Date);
  });
});

describe('Terms status + re-acceptance', () => {
  test('GET /auth/me reports current version and no re-acceptance needed after register', async () => {
    const email = `d_${Date.now()}@t.com`;
    // Register now returns a verification code (dev/test) rather than a token —
    // verifying the email is what logs the new user in.
    const reg = await request(app).post('/auth/register')
      .send({ ...base, email, acceptedTerms: true });
    const verify = await request(app).post('/auth/verify-email')
      .send({ email, code: reg.body.devCode });
    const token = verify.body.token;

    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.currentTermsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(me.body.needsTermsAcceptance).toBe(false);
  });

  test('a user on an older terms version needs re-acceptance, then clears it', async () => {
    // Simulate a user who agreed to a previous terms version.
    const user = await db.user.create({
      data: {
        email: `e_${Date.now()}@t.com`,
        passwordHash: 'x',
        name: 'Old Terms',
        role: 'CLIENT',
        termsAcceptedAt: new Date('2025-01-01'),
        termsVersion: '2025-01-01',
      },
    });
    const token = tokenFor(user);

    let me = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.needsTermsAcceptance).toBe(true);

    const accept = await request(app).post('/auth/accept-terms')
      .set('Authorization', `Bearer ${token}`);
    expect(accept.status).toBe(200);
    expect(accept.body.termsVersion).toBe(CURRENT_TERMS_VERSION);

    me = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.needsTermsAcceptance).toBe(false);
  });

  test('accept-terms requires auth', async () => {
    const res = await request(app).post('/auth/accept-terms');
    expect(res.status).toBe(401);
  });
});
