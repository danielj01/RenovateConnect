const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

describe('GET /feed — inspiration', () => {
  test('flattens approved portfolio photos and pairs before/after', async () => {
    const { business } = await createBusiness({ companyName: 'Reno Co' });
    await db.portfolioProject.create({
      data: {
        businessId: business.id,
        title: 'Kitchen redo',
        category: 'Kitchen',
        costMin: 20000,
        costMax: 40000,
        approvalStatus: 'APPROVED',
        imageUrls: ['https://cdn.test/after1.jpg', 'https://cdn.test/after2.jpg'],
        beforeImageUrls: ['https://cdn.test/before1.jpg'], // pairs with index 0 only
      },
    });

    const res = await request(app).get('/feed');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);

    const first = res.body.items[0];
    expect(first.imageUrl).toBe('https://cdn.test/after1.jpg');
    expect(first.beforeImageUrl).toBe('https://cdn.test/before1.jpg');
    expect(first.isBeforeAfter).toBe(true);
    expect(first.business.companyName).toBe('Reno Co');
    expect(first.costMin).toBe(20000);

    // Second image has no paired before.
    expect(res.body.items[1].beforeImageUrl).toBeNull();
    expect(res.body.items[1].isBeforeAfter).toBe(false);
  });

  test('excludes pending/rejected projects', async () => {
    const { business } = await createBusiness();
    await db.portfolioProject.create({
      data: { businessId: business.id, title: 'Pending', approvalStatus: 'PENDING', imageUrls: ['https://cdn.test/x.jpg'] },
    });
    const res = await request(app).get('/feed');
    expect(res.body.items).toHaveLength(0);
  });

  test('filters by category', async () => {
    const { business } = await createBusiness();
    await db.portfolioProject.create({
      data: { businessId: business.id, title: 'K', category: 'Kitchen', approvalStatus: 'APPROVED', imageUrls: ['https://cdn.test/k.jpg'] },
    });
    await db.portfolioProject.create({
      data: { businessId: business.id, title: 'B', category: 'Bathroom', approvalStatus: 'APPROVED', imageUrls: ['https://cdn.test/b.jpg'] },
    });

    const res = await request(app).get('/feed?category=Bathroom');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe('B');
  });

  test('paginates with hasMore', async () => {
    const { business } = await createBusiness();
    const imageUrls = Array.from({ length: 5 }, (_, i) => `https://cdn.test/p${i}.jpg`);
    await db.portfolioProject.create({
      data: { businessId: business.id, title: 'Many', approvalStatus: 'APPROVED', imageUrls },
    });

    const res = await request(app).get('/feed?limit=2&page=1');
    expect(res.body.items).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);

    const last = await request(app).get('/feed?limit=2&page=3');
    expect(last.body.items).toHaveLength(1);
    expect(last.body.hasMore).toBe(false);
  });
});
