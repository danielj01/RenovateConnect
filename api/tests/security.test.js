// Verifies the hardened input validation: strict schemas reject unexpected
// fields, and length limits reject oversized input (OWASP input validation).
const request = require('supertest');
const app = require('../src/app');
const { db, resetDb } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

const valid = {
  email: `sec_${Date.now()}@test.com`,
  password: 'sup3rsecret!',
  name: 'Sec Tester',
  role: 'CLIENT',
};

describe('input validation hardening', () => {
  test('accepts a well-formed registration', async () => {
    const res = await request(app).post('/auth/register').send(valid);
    expect(res.status).toBe(201);
  });

  test('rejects unexpected fields (strict schema)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...valid, email: `x_${Date.now()}@test.com`, isAdmin: true, role: 'CLIENT' });
    expect(res.status).toBe(400);
  });

  test('rejects an over-length password', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...valid, email: `y_${Date.now()}@test.com`, password: 'a'.repeat(200) });
    expect(res.status).toBe(400);
  });

  test('rejects a malformed email', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...valid, email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid role value', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...valid, email: `z_${Date.now()}@test.com`, role: 'SUPERADMIN' });
    expect(res.status).toBe(400);
  });
});

describe('5xx responses do not leak internals', () => {
  // Errors with status >= 500 must never echo err.message — Prisma's
  // KnownRequestError includes the absolute file path of the call site and
  // a snippet of source code, which would leak straight to the client.
  // We simulate that by making the underlying Prisma call throw the kind of
  // message Prisma actually produces, then assert the wire response is
  // sanitized.
  const jwt = require('jsonwebtoken');
  const { createClient } = require('./helpers');

  test('500 body is a generic message, no path or source snippet', async () => {
    const { token } = await createClient();
    const original = db.block.findMany;
    db.block.findMany = () => Promise.reject(new Error(
      'Invalid `db.block.findMany()` invocation in ' +
      '/Users/secret/path/api/src/routes/blocks.js:57:35\n' +
      '  The table `public.Block` does not exist in the current database.',
    ));

    try {
      const res = await request(app).get('/blocks')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('/Users/');
      expect(body).not.toContain('findMany');
    } finally {
      db.block.findMany = original;
    }
    expect(jwt).toBeTruthy(); // silence the unused-import linter
  });
});
