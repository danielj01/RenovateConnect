const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient } = require('./helpers');
const push = require('../src/services/push');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

describe('PATCH /auth/me', () => {
  test('updates the push preference and returns the user', async () => {
    const { user, token } = await createClient();
    const res = await request(app)
      .patch('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ pushEnabled: false });

    expect(res.status).toBe(200);
    expect(res.body.pushEnabled).toBe(false);
    expect(res.body.passwordHash).toBeUndefined();

    const stored = await db.user.findUnique({ where: { id: user.id } });
    expect(stored.pushEnabled).toBe(false);
  });

  test('requires authentication', async () => {
    const res = await request(app).patch('/auth/me').send({ pushEnabled: false });
    expect(res.status).toBe(401);
  });

  test('disabling push makes sendPush skip the user even with a registered token', async () => {
    const { user, token } = await createClient();
    await db.deviceToken.create({ data: { token: 'tok-1', userId: user.id } });
    await request(app).patch('/auth/me').set('Authorization', `Bearer ${token}`).send({ pushEnabled: false });

    // Configure APNs so isConfigured() passes — the skip must come from the
    // user's preference gate, not the "not configured" early return. No network
    // call happens because we bail before delivery.
    const saved = { ...process.env };
    process.env.APNS_KEY_ID = 'KID0000000';
    process.env.APNS_TEAM_ID = 'TEAM000000';
    process.env.APNS_BUNDLE_ID = 'com.test.app';
    process.env.APNS_KEY = 'dummy';
    try {
      expect(push.isConfigured()).toBe(true);
      const result = await push.sendPush(user.id, { title: 'Hi', body: 'There' });
      expect(result).toEqual({ skipped: true });
    } finally {
      process.env = saved;
    }
  });
});
