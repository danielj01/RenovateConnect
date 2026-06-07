// Mock S3 so message image uploads never hit AWS.
jest.mock('../src/services/storage', () => {
  let n = 0;
  return {
    uploadImage: jest.fn(async () => `https://cdn.test/msg-${++n}.jpg`),
  };
});

const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient } = require('./helpers');
const storage = require('../src/services/storage');

beforeEach(async () => {
  await resetDb();
  storage.uploadImage.mockClear();
});
afterAll(async () => { await db.$disconnect(); });

const tinyPng = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489' +
  '0000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082',
  'hex'
);

async function conversationFor() {
  const { user: client, token } = await createClient();
  const { business } = await createBusiness({ email: 'pro@test.com' });
  const conversation = await db.conversation.create({
    data: { clientId: client.id, businessId: business.id },
  });
  return { client, token, conversation };
}

describe('message image attachments', () => {
  test('sends a message with an image; URLs are stored', async () => {
    const { token, conversation } = await conversationFor();
    const res = await request(app)
      .post(`/conversations/${conversation.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .field('body', 'Here is the kitchen')
      .attach('images', tinyPng, { filename: 'k.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.body).toBe('Here is the kitchen');
    expect(res.body.imageUrls).toHaveLength(1);
    expect(res.body.imageUrls[0]).toMatch(/msg-1\.jpg$/);
    expect(storage.uploadImage).toHaveBeenCalledTimes(1);
  });

  test('allows an image-only message (no text body)', async () => {
    const { token, conversation } = await conversationFor();
    const res = await request(app)
      .post(`/conversations/${conversation.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .attach('images', tinyPng, { filename: 'a.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.body).toBe('');
    expect(res.body.imageUrls).toHaveLength(1);
  });

  test('rejects a message with neither text nor image', async () => {
    const { token, conversation } = await conversationFor();
    const res = await request(app)
      .post(`/conversations/${conversation.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });

  test('still accepts a plain JSON text message', async () => {
    const { token, conversation } = await conversationFor();
    const res = await request(app)
      .post(`/conversations/${conversation.id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Just text' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('Just text');
    expect(res.body.imageUrls).toEqual([]);
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });
});
