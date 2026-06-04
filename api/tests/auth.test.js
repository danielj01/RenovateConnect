const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness } = require('./helpers');
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

  test('updates the display name', async () => {
    const { user, token } = await createClient();
    const res = await request(app)
      .patch('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed Person' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed Person');
    const stored = await db.user.findUnique({ where: { id: user.id } });
    expect(stored.name).toBe('Renamed Person');
  });

  test('rejects a blank name', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .patch('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /auth/me', () => {
  test('requires authentication', async () => {
    const res = await request(app).delete('/auth/me');
    expect(res.status).toBe(401);
  });

  test('deletes a homeowner and their conversation, leaving the contractor', async () => {
    const { user: client, token } = await createClient();
    const { user: owner, business } = await createBusiness();

    const conversation = await db.conversation.create({
      data: { clientId: client.id, businessId: business.id },
    });
    await db.message.create({
      data: { conversationId: conversation.id, senderId: client.id, body: 'Hi there' },
    });
    await db.lead.create({
      data: { conversationId: conversation.id, businessId: business.id },
    });
    await db.deviceToken.create({ data: { token: 'tok-client', userId: client.id } });

    const res = await request(app)
      .delete('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect(await db.user.findUnique({ where: { id: client.id } })).toBeNull();
    expect(await db.conversation.findUnique({ where: { id: conversation.id } })).toBeNull();
    expect(await db.lead.count()).toBe(0);
    expect(await db.message.count()).toBe(0);
    expect(await db.deviceToken.count()).toBe(0);

    // The contractor and their business are untouched.
    expect(await db.user.findUnique({ where: { id: owner.id } })).not.toBeNull();
    expect(await db.business.findUnique({ where: { id: business.id } })).not.toBeNull();
  });

  test('deletes a contractor along with their business and conversations', async () => {
    const { user: client } = await createClient();
    const { user: owner, business, token } = await createBusiness();

    const conversation = await db.conversation.create({
      data: { clientId: client.id, businessId: business.id },
    });
    await db.message.create({
      data: { conversationId: conversation.id, senderId: owner.id, body: 'Thanks!' },
    });
    await db.lead.create({
      data: { conversationId: conversation.id, businessId: business.id },
    });

    const res = await request(app)
      .delete('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect(await db.user.findUnique({ where: { id: owner.id } })).toBeNull();
    expect(await db.business.findUnique({ where: { id: business.id } })).toBeNull();
    expect(await db.conversation.count()).toBe(0);
    expect(await db.lead.count()).toBe(0);
    expect(await db.message.count()).toBe(0);

    // The homeowner who messaged them is untouched.
    expect(await db.user.findUnique({ where: { id: client.id } })).not.toBeNull();
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
