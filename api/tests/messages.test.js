const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

// Create a conversation between a client and business, optionally with messages.
async function seedConversation(business, client) {
  return db.conversation.create({
    data: { clientId: client.id, businessId: business.id },
  });
}

async function sendMessageAs(conversationId, senderId, body) {
  return db.message.create({ data: { conversationId, senderId, body } });
}

describe('Conversation read state', () => {
  test('unread count reflects messages from the other party', async () => {
    const { business, token: bizToken } = await createBusiness();
    const { user: client, token: clientToken } = await createClient();
    const conv = await seedConversation(business, client);

    // Client sends two messages; business has read nothing yet.
    await sendMessageAs(conv.id, client.id, 'Hi, kitchen remodel?');
    await sendMessageAs(conv.id, client.id, 'Around $20k budget.');

    // Business sees 2 unread on the conversation list...
    const bizList = await request(app).get('/conversations').set('Authorization', `Bearer ${bizToken}`);
    expect(bizList.status).toBe(200);
    expect(bizList.body[0].unreadCount).toBe(2);

    // ...and the client sees 0 (they sent them).
    const clientList = await request(app).get('/conversations').set('Authorization', `Bearer ${clientToken}`);
    expect(clientList.body[0].unreadCount).toBe(0);
  });

  test('GET /conversations/unread returns the total across conversations', async () => {
    const { business, token: bizToken } = await createBusiness();
    const { user: client } = await createClient();
    const conv = await seedConversation(business, client);
    await sendMessageAs(conv.id, client.id, 'one');
    await sendMessageAs(conv.id, client.id, 'two');
    await sendMessageAs(conv.id, client.id, 'three');

    const res = await request(app).get('/conversations/unread').set('Authorization', `Bearer ${bizToken}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });

  test('marking read zeroes the unread count', async () => {
    const { business, token: bizToken } = await createBusiness();
    const { user: client } = await createClient();
    const conv = await seedConversation(business, client);
    await sendMessageAs(conv.id, client.id, 'unread message');

    let res = await request(app).get('/conversations/unread').set('Authorization', `Bearer ${bizToken}`);
    expect(res.body.count).toBe(1);

    const readRes = await request(app).post(`/conversations/${conv.id}/read`).set('Authorization', `Bearer ${bizToken}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.businessLastReadAt).toBeTruthy();

    res = await request(app).get('/conversations/unread').set('Authorization', `Bearer ${bizToken}`);
    expect(res.body.count).toBe(0);
  });

  test('messages sent after a read are unread again', async () => {
    const { business, token: bizToken } = await createBusiness();
    const { user: client } = await createClient();
    const conv = await seedConversation(business, client);

    await sendMessageAs(conv.id, client.id, 'first');
    await request(app).post(`/conversations/${conv.id}/read`).set('Authorization', `Bearer ${bizToken}`);

    // A new message arrives after the read timestamp.
    await sendMessageAs(conv.id, client.id, 'second');

    const res = await request(app).get('/conversations/unread').set('Authorization', `Bearer ${bizToken}`);
    expect(res.body.count).toBe(1);
  });

  test('sending a message marks the conversation read for the sender', async () => {
    const { business, token: bizToken } = await createBusiness();
    const { user: client, token: clientToken } = await createClient();
    const conv = await seedConversation(business, client);

    // Business sends a message via the API.
    const sendRes = await request(app)
      .post(`/conversations/${conv.id}/messages`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ body: 'Sure, we can help!' });
    expect(sendRes.status).toBe(201);

    // The business should not see its own message as unread.
    const bizUnread = await request(app).get('/conversations/unread').set('Authorization', `Bearer ${bizToken}`);
    expect(bizUnread.body.count).toBe(0);

    // The client should see it as unread.
    const clientUnread = await request(app).get('/conversations/unread').set('Authorization', `Bearer ${clientToken}`);
    expect(clientUnread.body.count).toBe(1);
  });

  test('starting a conversation does not count as unread for the sending client', async () => {
    const { business } = await createBusiness();
    const { token: clientToken } = await createClient();

    const start = await request(app)
      .post('/conversations')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, message: 'Hello there' });
    expect(start.status).toBe(201);

    const clientUnread = await request(app).get('/conversations/unread').set('Authorization', `Bearer ${clientToken}`);
    expect(clientUnread.body.count).toBe(0);
  });

  test('non-members cannot mark a conversation read', async () => {
    const { business } = await createBusiness();
    const { user: client } = await createClient();
    const conv = await seedConversation(business, client);

    const { token: outsiderToken } = await createBusiness({ email: 'outsider@test.com' });
    const res = await request(app).post(`/conversations/${conv.id}/read`).set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  test('marking read on a missing conversation returns 404', async () => {
    const { token } = await createBusiness();
    const res = await request(app).post('/conversations/nonexistent/read').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('unread endpoint requires authentication', async () => {
    const res = await request(app).get('/conversations/unread');
    expect(res.status).toBe(401);
  });
});
