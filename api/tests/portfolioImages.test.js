// Mock S3 so we never hit AWS in tests. The mock returns a deterministic URL
// per call so we can assert ordering when multiple images are uploaded at once.
jest.mock('../src/services/storage', () => {
  let n = 0;
  return {
    uploadImage: jest.fn(async () => `https://cdn.test/image-${++n}.jpg`),
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

describe('Portfolio image upload', () => {
  test('owner can upload images; URLs are appended in order', async () => {
    const { business, token } = await createBusiness();
    const project = await db.portfolioProject.create({
      data: { businessId: business.id, title: 'Kitchen', imageUrls: ['https://existing.test/1.jpg'] },
    });

    const res = await request(app)
      .post(`/businesses/${business.id}/portfolio/${project.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('images', tinyPng, { filename: 'a.png', contentType: 'image/png' })
      .attach('images', tinyPng, { filename: 'b.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.imageUrls).toHaveLength(3);
    expect(res.body.imageUrls[0]).toBe('https://existing.test/1.jpg');
    expect(res.body.imageUrls[1]).toMatch(/image-1\.jpg$/);
    expect(res.body.imageUrls[2]).toMatch(/image-2\.jpg$/);
    expect(storage.uploadImage).toHaveBeenCalledTimes(2);
  });

  test('rejects upload from a different business owner', async () => {
    const a = await createBusiness({ email: 'a@test.com' });
    const b = await createBusiness({ email: 'b@test.com' });
    const project = await db.portfolioProject.create({
      data: { businessId: a.business.id, title: 'Mine' },
    });
    const res = await request(app)
      .post(`/businesses/${a.business.id}/portfolio/${project.id}/images`)
      .set('Authorization', `Bearer ${b.token}`)
      .attach('images', tinyPng, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });

  test('clients (wrong role) cannot upload', async () => {
    const { business } = await createBusiness();
    const project = await db.portfolioProject.create({ data: { businessId: business.id, title: 'X' } });
    const { token } = await createClient();
    const res = await request(app)
      .post(`/businesses/${business.id}/portfolio/${project.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('images', tinyPng, { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  test('empty upload returns 400', async () => {
    const { business, token } = await createBusiness();
    const project = await db.portfolioProject.create({ data: { businessId: business.id, title: 'X' } });
    const res = await request(app)
      .post(`/businesses/${business.id}/portfolio/${project.id}/images`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('Portfolio image delete', () => {
  test('owner can remove a single image by URL; others remain', async () => {
    const { business, token } = await createBusiness();
    const project = await db.portfolioProject.create({
      data: {
        businessId: business.id,
        title: 'Many photos',
        imageUrls: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg', 'https://cdn.test/c.jpg'],
      },
    });
    const res = await request(app)
      .delete(`/businesses/${business.id}/portfolio/${project.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://cdn.test/b.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.imageUrls).toEqual(['https://cdn.test/a.jpg', 'https://cdn.test/c.jpg']);
  });

  test('delete is idempotent — removing an unknown URL is a no-op', async () => {
    const { business, token } = await createBusiness();
    const project = await db.portfolioProject.create({
      data: { businessId: business.id, title: 'X', imageUrls: ['https://cdn.test/a.jpg'] },
    });
    const res = await request(app)
      .delete(`/businesses/${business.id}/portfolio/${project.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://cdn.test/does-not-exist.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.imageUrls).toEqual(['https://cdn.test/a.jpg']);
  });
});
