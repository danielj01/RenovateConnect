// The waitlist confirmation email.
//
// Two things matter here and neither is "did we call SendGrid": (1) a person
// who joins twice must not get two welcomes — POST /waitlist is idempotent on
// email, so the send has to be gated on a stamp rather than on the insert; and
// (2) a mailer outage must never turn a captured signup into a failed one,
// because the signup itself is the thing we actually care about keeping.
//
// The whole email module is mocked (not just the waitlist function) because
// `src/app` pulls in the auth routes, which need the rest of its surface.

jest.mock('../src/services/email', () => ({
  isConfigured: () => true,
  assertEmailConfigured: () => {},
  sendEmail: jest.fn(async () => ({ ok: true })),
  sendVerificationCode: jest.fn(async () => ({ ok: true })),
  sendPasswordResetCode: jest.fn(async () => ({ ok: true })),
  sendListingExpiringNotice: jest.fn(async () => ({ ok: true })),
  sendListingLapsedNotice: jest.fn(async () => ({ ok: true })),
  sendWaitlistWelcome: jest.fn(async () => ({ ok: true })),
}));

const request = require('supertest');
const app = require('../src/app');
const { sendWaitlistWelcome } = require('../src/services/email');
const { db, resetDb } = require('./helpers');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
});
afterAll(async () => { await db.$disconnect(); });

describe('waitlist confirmation email', () => {
  test('sends once on join and stamps the row', async () => {
    const res = await request(app).post('/waitlist').send({ email: 'new@example.com' });
    expect(res.status).toBe(201);

    expect(sendWaitlistWelcome).toHaveBeenCalledTimes(1);
    expect(sendWaitlistWelcome).toHaveBeenCalledWith('new@example.com', { role: 'HOMEOWNER' });

    const row = await db.waitlistEntry.findUnique({ where: { email: 'new@example.com' } });
    expect(row.welcomeSentAt).toBeInstanceOf(Date);
  });

  test('passes the contractor role through so the copy matches what they read', async () => {
    await request(app).post('/waitlist')
      .send({ email: 'pro@example.com', role: 'CONTRACTOR', city: 'Oakland' });

    expect(sendWaitlistWelcome).toHaveBeenCalledWith('pro@example.com', { role: 'CONTRACTOR' });
  });

  test('does not re-send when the same address joins again', async () => {
    await request(app).post('/waitlist').send({ email: 'dup@example.com' });
    expect(sendWaitlistWelcome).toHaveBeenCalledTimes(1);

    const second = await request(app).post('/waitlist')
      .send({ email: 'dup@example.com', context: 'Kitchen' });
    expect(second.status).toBe(201);
    expect(sendWaitlistWelcome).toHaveBeenCalledTimes(1);
  });

  test('a send failure still captures the signup, and leaves it unstamped for a retry', async () => {
    sendWaitlistWelcome.mockRejectedValueOnce(new Error('SendGrid 502'));

    const res = await request(app).post('/waitlist').send({ email: 'flaky@example.com' });
    expect(res.status).toBe(201);

    const row = await db.waitlistEntry.findUnique({ where: { email: 'flaky@example.com' } });
    expect(row).not.toBeNull();
    expect(row.welcomeSentAt).toBeNull();

    // Unstamped, so the next touch tries again rather than losing the welcome.
    await request(app).post('/waitlist').send({ email: 'flaky@example.com' });
    expect(sendWaitlistWelcome).toHaveBeenCalledTimes(2);
  });

  test('an unconfigured mailer (skipped send) does not stamp the row', async () => {
    sendWaitlistWelcome.mockResolvedValueOnce({ skipped: true });

    await request(app).post('/waitlist').send({ email: 'nomailer@example.com' });
    const row = await db.waitlistEntry.findUnique({ where: { email: 'nomailer@example.com' } });
    expect(row.welcomeSentAt).toBeNull();
  });
});

describe('waitlistWelcomeEmail template', () => {
  // The real module, not the mock — this is about the copy itself.
  const { waitlistWelcomeEmail } = jest.requireActual('../src/services/email');

  test('homeowner copy promises what the landing page promises', () => {
    const mail = waitlistWelcomeEmail({ role: 'HOMEOWNER' });
    expect(mail.subject).toMatch(/waitlist/i);
    expect(mail.text).toMatch(/free for homeowners/i);
    expect(mail.text).toMatch(/never sell/i);
    // The referral model: we must not imply the platform handles the money.
    expect(mail.text).toMatch(/pay the contractor directly/i);
    expect(mail.text).not.toMatch(/escrow|deposit/i);
  });

  test('contractor copy states the price and the no-lead-fee promise', () => {
    const mail = waitlistWelcomeEmail({ role: 'CONTRACTOR' });
    expect(mail.subject).toMatch(/founding/i);
    expect(mail.text).toMatch(/\$10\/month/);
    expect(mail.text).toMatch(/no per-lead fees/i);
    expect(mail.text).toMatch(/no commission/i);
  });

  test('defaults to the homeowner variant', () => {
    expect(waitlistWelcomeEmail().subject).toBe(waitlistWelcomeEmail({ role: 'HOMEOWNER' }).subject);
  });

  test('both variants ship a text and an html part', () => {
    for (const role of ['HOMEOWNER', 'CONTRACTOR']) {
      const mail = waitlistWelcomeEmail({ role });
      expect(mail.text.length).toBeGreaterThan(80);
      expect(mail.html).toMatch(/^<p>/);
    }
  });
});
