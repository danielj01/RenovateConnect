const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness } = require('./helpers');
const push = require('../src/services/push');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

describe('Device token registration', () => {
  test('registers a device token for the user', async () => {
    const { user, token } = await createClient();
    const res = await request(app)
      .post('/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'abc123', platform: 'ios' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBe('abc123');

    const stored = await db.deviceToken.findUnique({ where: { token: 'abc123' } });
    expect(stored.userId).toBe(user.id);
    expect(stored.platform).toBe('ios');
  });

  test('re-registering the same token is idempotent and re-claims it', async () => {
    const a = await createClient({ email: 'a@test.com' });
    const b = await createClient({ email: 'b@test.com' });

    await request(app).post('/devices').set('Authorization', `Bearer ${a.token}`).send({ token: 'shared-token' });
    await request(app).post('/devices').set('Authorization', `Bearer ${b.token}`).send({ token: 'shared-token' });

    const all = await db.deviceToken.findMany({ where: { token: 'shared-token' } });
    expect(all).toHaveLength(1);
    expect(all[0].userId).toBe(b.user.id);
  });

  test('defaults platform to ios when omitted', async () => {
    const { token } = await createClient();
    const res = await request(app).post('/devices').set('Authorization', `Bearer ${token}`).send({ token: 'no-platform' });
    expect(res.body.platform).toBe('ios');
  });

  test('rejects registration without a token field', async () => {
    const { token } = await createClient();
    const res = await request(app).post('/devices').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400); // zod validation -> 400
  });

  test('requires authentication', async () => {
    const res = await request(app).post('/devices').send({ token: 'x' });
    expect(res.status).toBe(401);
  });

  test('deletes only the caller’s own token', async () => {
    const a = await createClient({ email: 'a2@test.com' });
    const b = await createClient({ email: 'b2@test.com' });
    await db.deviceToken.create({ data: { token: 'a-token', userId: a.user.id } });
    await db.deviceToken.create({ data: { token: 'b-token', userId: b.user.id } });

    // a tries to delete b's token — no-op (scoped to caller)
    await request(app).delete('/devices/b-token').set('Authorization', `Bearer ${a.token}`).expect(204);
    expect(await db.deviceToken.findUnique({ where: { token: 'b-token' } })).not.toBeNull();

    // a deletes its own token
    await request(app).delete('/devices/a-token').set('Authorization', `Bearer ${a.token}`).expect(204);
    expect(await db.deviceToken.findUnique({ where: { token: 'a-token' } })).toBeNull();
  });
});

describe('push service (unconfigured environment)', () => {
  test('isConfigured() is false without APNs env', () => {
    expect(push.isConfigured()).toBe(false);
  });

  test('sendPush no-ops gracefully when APNs is not configured', async () => {
    const { user } = await createClient();
    await db.deviceToken.create({ data: { token: 'tok', userId: user.id } });
    const result = await push.sendPush(user.id, { title: 'Hi', body: 'There' });
    expect(result).toEqual({ skipped: true });
  });

  test('buildPayload nests alert/sound under aps and merges data', () => {
    const payload = push.buildPayload({ title: 'T', body: 'B', badge: 3, data: { conversationId: 'c1', type: 'message' } });
    expect(payload.aps.alert).toEqual({ title: 'T', body: 'B' });
    expect(payload.aps.sound).toBe('default');
    expect(payload.aps.badge).toBe(3);
    expect(payload.conversationId).toBe('c1');
    expect(payload.type).toBe('message');
  });

  test('isDeadToken flags 410 / BadDeviceToken / Unregistered', () => {
    expect(push.isDeadToken({ status: 410 })).toBe(true);
    expect(push.isDeadToken({ reason: 'BadDeviceToken' })).toBe(true);
    expect(push.isDeadToken({ reason: 'Unregistered' })).toBe(true);
    expect(push.isDeadToken({ status: 200 })).toBe(false);
  });
});

describe('push triggers do not break the request flow', () => {
  test('sending a message still succeeds with push wired in', async () => {
    const { business } = await createBusiness();
    const { token: clientToken } = await createClient();
    const start = await request(app)
      .post('/conversations')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, message: 'Hello' });
    expect(start.status).toBe(201);

    const send = await request(app)
      .post(`/conversations/${start.body.id}/messages`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ body: 'Follow-up question' });
    expect(send.status).toBe(201);
  });
});
