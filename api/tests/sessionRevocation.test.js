const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { db, resetDb, createClient } = require('./helpers');

beforeEach(resetDb);
afterAll(() => db.$disconnect());
const me = (token) => request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

async function account() {
  const result = await createClient();
  await db.user.update({ where: { id: result.user.id }, data: { passwordHash: await bcrypt.hash('old-password', 4) } });
  return result;
}

test('password change revokes legacy sessions and returns a working replacement', async () => {
  const { user, token } = await account();
  const failed = await request(app).post('/auth/change-password').set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'incorrect', newPassword: 'new-password' });
  expect(failed.status).toBe(401);
  expect((await me(token)).status).toBe(200);
  const res = await request(app).post('/auth/change-password').set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'old-password', newPassword: 'new-password' });
  expect(res.status).toBe(200);
  expect((await me(token)).status).toBe(401);
  const fresh = await me(res.body.token);
  expect(fresh.status).toBe(200);
  expect(fresh.body.sessionVersion).toBeUndefined();
  const login = await request(app).post('/auth/login').send({ email: user.email, password: 'new-password' });
  expect((await me(login.body.token)).status).toBe(200);
});

test('password reset revokes sessions and the same code cannot be reused concurrently', async () => {
  const { user, token } = await account();
  const forgot = await request(app).post('/auth/forgot-password').send({ email: user.email });
  const results = await Promise.all([1, 2].map(() => request(app).post('/auth/reset-password')
    .send({ email: user.email, code: forgot.body.devCode, password: 'reset-password' })));
  expect(results.map(r => r.status).sort()).toEqual([200, 400]);
  expect((await me(token)).status).toBe(401);
  expect((await me(results.find(r => r.status === 200).body.token)).status).toBe(200);
});

test('deleted users cannot continue using signed tokens', async () => {
  const { user, token } = await account();
  await db.user.delete({ where: { id: user.id } });
  expect((await me(token)).status).toBe(401);
});

test('authorization uses the current database role instead of stale token privileges', async () => {
  const { user } = await account();
  const token = jwt.sign({ id: user.id, role: 'ADMIN', sessionVersion: 0 }, process.env.JWT_SECRET);
  const res = await request(app).get('/admin/businesses').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(403);
});

test('revoked owner tokens cannot preview private business content through optional auth', async () => {
  const { createBusiness } = require('./helpers');
  const { user, business, token } = await createBusiness({ approvalStatus: 'PENDING' });
  expect((await request(app).get(`/businesses/${business.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(200);
  await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
  expect((await request(app).get(`/businesses/${business.id}`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
});
