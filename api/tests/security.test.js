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
