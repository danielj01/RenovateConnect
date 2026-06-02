// Runs before any module is imported by a test file.
// Point the app + Prisma at an isolated test database and fix the JWT secret.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://danieljeznach@localhost:5432/renovate_connect_test';
// Stripe is only constructed, never called, in these tests.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
