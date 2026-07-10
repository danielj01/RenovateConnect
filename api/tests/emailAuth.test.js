// Email verification, password reset/change, and the account-pre-hijack
// hardening. Email delivery is unconfigured under test, so the endpoints return
// the code as `devCode` and nothing is actually sent.
const request = require('supertest');
const app = require('../src/app');
const bcrypt = require('bcryptjs');
const { db, resetDb } = require('./helpers');

// Each flow does several cost-12 bcrypt operations (register hash + login
// compare + reset/change), so give the suite headroom over the 5 s default —
// otherwise it flakes under full-suite in-band load.
jest.setTimeout(30000);

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

const base = { password: 'sup3rsecret!', name: 'New User', role: 'CLIENT', acceptedTerms: true };

async function register(email, overrides = {}) {
  return request(app).post('/auth/register').send({ ...base, email, ...overrides });
}

describe('Registration → email verification', () => {
  test('register does not return a token; it returns a verification code (dev)', async () => {
    const res = await register('newbie@t.com');
    expect(res.status).toBe(201);
    expect(res.body.token).toBeUndefined();
    expect(res.body.needsEmailVerification).toBe(true);
    expect(res.body.devCode).toMatch(/^\d{6}$/);

    const user = await db.user.findUnique({ where: { email: 'newbie@t.com' } });
    expect(user.emailVerified).toBe(false);
  });

  test('login is blocked (403) until the email is verified', async () => {
    await register('pending@t.com');
    const login = await request(app).post('/auth/login')
      .send({ email: 'pending@t.com', password: base.password });
    expect(login.status).toBe(403);
    expect(login.body.needsEmailVerification).toBe(true);
    // Login does not itself send a code; the app uses resend-verification.
    const resend = await request(app).post('/auth/resend-verification')
      .send({ email: 'pending@t.com' });
    expect(resend.status).toBe(200);
    expect(resend.body.devCode).toMatch(/^\d{6}$/);
  });

  test('verifying the emailed code logs the user in and flips emailVerified', async () => {
    const reg = await register('verify-me@t.com');
    const verify = await request(app).post('/auth/verify-email')
      .send({ email: 'verify-me@t.com', code: reg.body.devCode });
    expect(verify.status).toBe(200);
    expect(verify.body.token).toBeTruthy();

    const user = await db.user.findUnique({ where: { email: 'verify-me@t.com' } });
    expect(user.emailVerified).toBe(true);
    expect(user.emailVerifyCodeHash).toBeNull();

    // And now a normal login works.
    const login = await request(app).post('/auth/login')
      .send({ email: 'verify-me@t.com', password: base.password });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  test('a wrong or expired code is rejected', async () => {
    await register('wrongcode@t.com');
    const bad = await request(app).post('/auth/verify-email')
      .send({ email: 'wrongcode@t.com', code: '000000' });
    expect(bad.status).toBe(400);

    // Expire the real code and confirm it no longer works.
    const gen = await register('expired@t.com');
    await db.user.update({
      where: { email: 'expired@t.com' },
      data: { emailVerifyExpiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await request(app).post('/auth/verify-email')
      .send({ email: 'expired@t.com', code: gen.body.devCode });
    expect(expired.status).toBe(400);
  });
});

describe('Account pre-hijack protection', () => {
  test('an unverified squat can be taken over by a new registration', async () => {
    // Attacker pre-registers an email they do not own.
    const attacker = await register('victim@t.com', { name: 'Attacker', password: 'attackerpass1' });
    expect(attacker.status).toBe(201);

    // The real owner registers the same email — allowed, because nobody has
    // verified it — and receives a fresh code.
    const owner = await register('victim@t.com', { name: 'Real Owner', password: 'ownerpass12' });
    expect(owner.status).toBe(201);
    expect(owner.body.devCode).toBeDefined();

    // Only the owner's code (the latest) verifies, and it sets the owner's name.
    const verify = await request(app).post('/auth/verify-email')
      .send({ email: 'victim@t.com', code: owner.body.devCode });
    expect(verify.status).toBe(200);
    const user = await db.user.findUnique({ where: { email: 'victim@t.com' } });
    expect(user.name).toBe('Real Owner');

    // The attacker's original password no longer works.
    const attackerLogin = await request(app).post('/auth/login')
      .send({ email: 'victim@t.com', password: 'attackerpass1' });
    expect(attackerLogin.status).toBe(401);
  });

  test('a verified email cannot be re-registered (409)', async () => {
    const reg = await register('taken@t.com');
    await request(app).post('/auth/verify-email').send({ email: 'taken@t.com', code: reg.body.devCode });
    const again = await register('taken@t.com', { password: 'somethingnew1' });
    expect(again.status).toBe(409);
  });

  test('social sign-in adopting an unverified account rotates its password', async () => {
    // A password account pre-registered for an address, never verified.
    const reg = await register('social@t.com', { password: 'preset-password1' });
    expect(reg.status).toBe(201);
    const before = await db.user.findUnique({ where: { email: 'social@t.com' } });

    // Simulate the provider-verified social sign-in adopting it.
    const { socialSignInForTest } = require('../src/routes/auth');
    await socialSignInForTest({ email: 'social@t.com', name: 'Google User' });

    const after = await db.user.findUnique({ where: { email: 'social@t.com' } });
    expect(after.emailVerified).toBe(true);
    expect(after.passwordHash).not.toBe(before.passwordHash);

    // The pre-set password no longer authenticates.
    const login = await request(app).post('/auth/login')
      .send({ email: 'social@t.com', password: 'preset-password1' });
    expect(login.status).toBe(401);
  });
});

describe('User payloads never leak secrets', () => {
  test('GET /auth/me omits the password hash and all code fields', async () => {
    const reg = await register('meview@t.com');
    const verify = await request(app).post('/auth/verify-email')
      .send({ email: 'meview@t.com', code: reg.body.devCode });
    const me = await request(app).get('/auth/me')
      .set('Authorization', `Bearer ${verify.body.token}`);
    expect(me.status).toBe(200);
    for (const field of [
      'passwordHash', 'emailVerifyCodeHash', 'emailVerifyExpiresAt',
      'passwordResetCodeHash', 'passwordResetExpiresAt',
    ]) {
      expect(me.body[field]).toBeUndefined();
    }
    // The harmless verification flag is still surfaced for the app to gate on.
    expect(me.body.emailVerified).toBe(true);
  });
});

describe('Password reset + change', () => {
  async function verifiedUser(email, password = 'origpass123') {
    const reg = await register(email, { password });
    await request(app).post('/auth/verify-email').send({ email, code: reg.body.devCode });
    return { email, password };
  }

  test('forgot-password always 200 and does not reveal whether the email exists', async () => {
    const known = await request(app).post('/auth/forgot-password').send({ email: 'nobody@t.com' });
    expect(known.status).toBe(200);
    expect(known.body.ok).toBe(true);
    // No code is issued for a non-existent account.
    expect(known.body.devCode).toBeUndefined();
  });

  test('reset with the emailed code sets a new password and logs in', async () => {
    const { email } = await verifiedUser('resetme@t.com');
    const forgot = await request(app).post('/auth/forgot-password').send({ email });
    expect(forgot.body.devCode).toMatch(/^\d{6}$/);

    const reset = await request(app).post('/auth/reset-password')
      .send({ email, code: forgot.body.devCode, password: 'brandnewpass9' });
    expect(reset.status).toBe(200);
    expect(reset.body.token).toBeTruthy();

    // Old password fails, new one works.
    const oldLogin = await request(app).post('/auth/login').send({ email, password: 'origpass123' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/auth/login').send({ email, password: 'brandnewpass9' });
    expect(newLogin.status).toBe(200);
  });

  test('reset with a wrong code is rejected', async () => {
    const { email } = await verifiedUser('resetbad@t.com');
    await request(app).post('/auth/forgot-password').send({ email });
    const reset = await request(app).post('/auth/reset-password')
      .send({ email, code: '111111', password: 'whatever12345' });
    expect(reset.status).toBe(400);
  });

  test('change-password requires the correct current password', async () => {
    const { email, password } = await verifiedUser('changer@t.com');
    const login = await request(app).post('/auth/login').send({ email, password });
    const token = login.body.token;

    const wrong = await request(app).post('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'nope-wrong-pass', newPassword: 'freshpass1234' });
    expect(wrong.status).toBe(401);

    const ok = await request(app).post('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: 'freshpass1234' });
    expect(ok.status).toBe(200);

    const relogin = await request(app).post('/auth/login').send({ email, password: 'freshpass1234' });
    expect(relogin.status).toBe(200);
  });
});
