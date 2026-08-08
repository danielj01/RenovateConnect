// Runs before any module is imported by a test file.
// Point the app + Prisma at an isolated test database and fix the JWT secret.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://danieljeznach@localhost:5432/renovate_connect_test';
// Stripe is only constructed, never called, in these tests.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

// Neutralize transactional email for the whole suite.
//
// Prisma loads api/.env when PrismaClient is constructed, so a developer's real
// SENDGRID_API_KEY leaks into the test process the moment src/app is imported.
// That did two bad things: it made assertions non-deterministic (the auth
// endpoints stop returning `devCode` once email is "configured"), and — far
// worse — the suite would fire REAL emails at the fake addresses tests use
// (newbie@t.com, victim@t.com, …). Those hard-bounce, and bounce rate on a new
// sending domain is what destroys deliverability.
//
// Assigning empty strings rather than deleting the keys is deliberate: dotenv
// (which Prisma uses) only fills in variables that are *absent*, so a defined
// empty value survives, whereas a deleted one would be repopulated from .env.
// Empty is falsy, so services/email.js isConfigured() stays false and every
// send short-circuits to { skipped: true }.
process.env.SENDGRID_API_KEY = '';
process.env.EMAIL_FROM = '';

// Same reasoning for the OpenAI-compatible text provider (NVIDIA NIM /
// DeepSeek): a real NVIDIA_API_KEY in .env would otherwise route chat tests at
// the live endpoint — burning quota and making the suite depend on a network
// call. Tests that exercise the provider set the key themselves and stub fetch.
process.env.NVIDIA_API_KEY = '';
