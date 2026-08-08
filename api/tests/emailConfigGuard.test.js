// Boot-time guard for transactional email.
//
// Email is load-bearing for auth: registration is gated on a verification code
// and there's no other recovery path. A production deploy missing SendGrid
// doesn't degrade gracefully — forgot-password returns {ok:true} and sends
// nothing, and new users can never verify. That's a silent, total outage of
// signup, so the server refuses to start instead.
const { assertEmailConfigured } = require('../src/services/email');

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

function setEnv({ nodeEnv, key, from }) {
  process.env.NODE_ENV = nodeEnv;
  if (key === undefined) delete process.env.SENDGRID_API_KEY;
  else process.env.SENDGRID_API_KEY = key;
  if (from === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = from;
}

// Canary. Prisma loads api/.env when its client is constructed, so a real
// SENDGRID_API_KEY on a developer's machine silently leaks into the suite and
// makes it send actual email to the fake addresses these tests use — hard
// bounces that damage the sending domain's reputation. tests/env.js blanks
// both vars to prevent it; this fails loudly if that ever stops working.
describe('the test suite never has live email credentials', () => {
  test('email is neutralized regardless of the local .env', () => {
    // eslint-disable-next-line global-require
    const email = require('../src/services/email');
    // Importing the app is what pulls in Prisma (and therefore .env).
    // eslint-disable-next-line global-require
    require('../src/app');
    expect(email.isConfigured()).toBe(false);
  });
});

describe('assertEmailConfigured', () => {
  test('throws in production when email is entirely unconfigured', () => {
    setEnv({ nodeEnv: 'production' });
    expect(() => assertEmailConfigured()).toThrow(/SendGrid is required in production/);
  });

  test('throws in production when only the API key is set', () => {
    setEnv({ nodeEnv: 'production', key: 'SG.fake' });
    expect(() => assertEmailConfigured()).toThrow(/SENDGRID_API_KEY and EMAIL_FROM/);
  });

  test('throws in production when only the from-address is set', () => {
    setEnv({ nodeEnv: 'production', from: 'no-reply@example.com' });
    expect(() => assertEmailConfigured()).toThrow();
  });

  test('passes in production when both are set', () => {
    setEnv({ nodeEnv: 'production', key: 'SG.fake', from: 'no-reply@example.com' });
    expect(() => assertEmailConfigured()).not.toThrow();
  });

  test('never blocks a non-production boot (dev/CI run without SendGrid)', () => {
    setEnv({ nodeEnv: 'development' });
    expect(() => assertEmailConfigured()).not.toThrow();
    setEnv({ nodeEnv: 'test' });
    expect(() => assertEmailConfigured()).not.toThrow();
  });

  test('the message names both vars so the fix is obvious from the crash log', () => {
    setEnv({ nodeEnv: 'production' });
    let message = '';
    try { assertEmailConfigured(); } catch (e) { message = e.message; }
    expect(message).toMatch(/SENDGRID_API_KEY/);
    expect(message).toMatch(/EMAIL_FROM/);
    expect(message).toMatch(/authenticated domain/);
  });
});
