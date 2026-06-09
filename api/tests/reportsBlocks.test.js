const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient, createAdmin } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

describe('Reports', () => {
  test('any authenticated user can file a report', async () => {
    const { user: client, token } = await createClient();
    const { business } = await createBusiness();

    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({
        targetType: 'BUSINESS',
        targetId: business.id,
        reason: 'SCAM',
        details: 'Looks fake to me',
      });
    expect(res.status).toBe(201);
    expect(res.body.reporterId).toBe(client.id);
    expect(res.body.status).toBe('PENDING');
  });

  test('rejects unknown reason / target type', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ targetType: 'GALAXY', targetId: 'x', reason: 'SPAM' });
    expect(res.status).toBe(400);
  });

  test('non-admin cannot see the review queue', async () => {
    const { token } = await createClient();
    const res = await request(app).get('/reports').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('admin can list pending reports and resolve them', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    const { token: adminToken, user: admin } = await createAdmin();

    const filed = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ targetType: 'BUSINESS', targetId: business.id, reason: 'SCAM' });
    expect(filed.status).toBe(201);

    const queue = await request(app).get('/reports').set('Authorization', `Bearer ${adminToken}`);
    expect(queue.status).toBe(200);
    expect(queue.body.length).toBe(1);
    expect(queue.body[0].reporter.id).toBeTruthy();

    const resolved = await request(app)
      .patch(`/reports/${filed.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED', resolution: 'Warned the business' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolvedById).toBe(admin.id);

    // Pending queue is now empty.
    const after = await request(app).get('/reports').set('Authorization', `Bearer ${adminToken}`);
    expect(after.body.length).toBe(0);
  });
});

describe('Blocks', () => {
  test('blocking is idempotent and refuses self-block', async () => {
    const { user: client, token } = await createClient();
    const { user: other } = await createClient();

    const self = await request(app).post('/blocks')
      .set('Authorization', `Bearer ${token}`).send({ userId: client.id });
    expect(self.status).toBe(400);

    const first = await request(app).post('/blocks')
      .set('Authorization', `Bearer ${token}`).send({ userId: other.id });
    expect(first.status).toBe(201);

    const second = await request(app).post('/blocks')
      .set('Authorization', `Bearer ${token}`).send({ userId: other.id });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.blocked.id).toBe(other.id);

    const count = await db.block.count({ where: { blockerId: client.id } });
    expect(count).toBe(1);
  });

  test('GET /blocks returns the caller list with names; DELETE removes it', async () => {
    const { token } = await createClient();
    const { user: bob } = await createClient({ name: 'Bob' });

    await request(app).post('/blocks')
      .set('Authorization', `Bearer ${token}`).send({ userId: bob.id });

    const list = await request(app).get('/blocks').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body[0].blocked.name).toBe('Bob');

    const del = await request(app).delete(`/blocks/${bob.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const empty = await request(app).get('/blocks').set('Authorization', `Bearer ${token}`);
    expect(empty.body.length).toBe(0);
  });

  test('a client blocked by a contractor cannot open a new conversation', async () => {
    const { user: bizOwner, business } = await createBusiness();
    const { user: client, token: clientToken } = await createClient();

    // Contractor blocks the homeowner.
    await db.block.create({ data: { blockerId: bizOwner.id, blockedId: client.id } });

    const res = await request(app)
      .post('/conversations')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, message: 'hello?' });
    expect(res.status).toBe(403);
  });

  test('blocking after-the-fact hides the thread and refuses further messages', async () => {
    const { user: bizOwner, business, token: bizToken } = await createBusiness();
    const { user: client, token: clientToken } = await createClient();

    // Existing conversation.
    const conv = await db.conversation.create({
      data: { clientId: client.id, businessId: business.id },
    });
    await db.message.create({
      data: { conversationId: conv.id, senderId: client.id, body: 'hi' },
    });

    // Homeowner blocks the contractor.
    await db.block.create({ data: { blockerId: client.id, blockedId: bizOwner.id } });

    // Contractor's inbox no longer shows the thread.
    const inbox = await request(app).get('/conversations')
      .set('Authorization', `Bearer ${bizToken}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.length).toBe(0);

    // Neither side can send into it.
    const fromBiz = await request(app)
      .post(`/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ body: 'still there?' });
    expect(fromBiz.status).toBe(403);

    const fromClient = await request(app)
      .post(`/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ body: 'changed my mind' });
    expect(fromClient.status).toBe(403);
  });
});
