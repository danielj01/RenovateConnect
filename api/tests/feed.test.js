const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

describe('GET /feed — inspiration', () => {
  test('a portfolio project is ONE item whose photos are its slides', async () => {
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
    // One post, not one item per photo — the whole point of the slideshow feed.
    expect(res.body.items).toHaveLength(1);

    const item = res.body.items[0];
    expect(item.kind).toBe('PROJECT');
    expect(item.slideCount).toBe(2);
    expect(item.business.companyName).toBe('Reno Co');
    expect(item.costMin).toBe(20000);

    expect(item.slides[0].imageUrl).toBe('https://cdn.test/after1.jpg');
    expect(item.slides[0].beforeImageUrl).toBe('https://cdn.test/before1.jpg');
    expect(item.slides[0].isBeforeAfter).toBe(true);
    // Second slide has no paired before.
    expect(item.slides[1].beforeImageUrl).toBeNull();
    expect(item.slides[1].isBeforeAfter).toBe(false);

    // Flat cover fields mirror slides[0].
    expect(item.imageUrl).toBe('https://cdn.test/after1.jpg');
    expect(item.beforeImageUrl).toBe('https://cdn.test/before1.jpg');
    expect(item.isBeforeAfter).toBe(true);
    expect(item.projectId).toBeTruthy();
    expect(item.postId).toBeNull();
  });

  test('native inspiration posts appear alongside portfolio projects', async () => {
    const { business } = await createBusiness({ companyName: 'Post Co' });
    await db.inspirationPost.create({
      data: {
        businessId: business.id,
        title: 'Herringbone backsplash',
        caption: 'Went in this morning.',
        category: 'Kitchen',
        approvalStatus: 'APPROVED',
        imageUrls: ['https://cdn.test/s1.jpg', 'https://cdn.test/s2.jpg', 'https://cdn.test/s3.jpg'],
        beforeImageUrls: [],
      },
    });
    await db.portfolioProject.create({
      data: {
        businessId: business.id,
        title: 'Old project',
        approvalStatus: 'APPROVED',
        imageUrls: ['https://cdn.test/p.jpg'],
      },
    });

    const res = await request(app).get('/feed');
    expect(res.body.items).toHaveLength(2);
    const post = res.body.items.find((i) => i.kind === 'POST');
    expect(post).toBeTruthy();
    expect(post.title).toBe('Herringbone backsplash');
    expect(post.caption).toBe('Went in this morning.');
    expect(post.slideCount).toBe(3);
    expect(post.postId).toBeTruthy();
    expect(post.projectId).toBeNull();
  });

  test('source=posts / source=projects filter by kind', async () => {
    const { business } = await createBusiness();
    await db.inspirationPost.create({
      data: { businessId: business.id, title: 'P', approvalStatus: 'APPROVED', imageUrls: ['https://cdn.test/a.jpg'] },
    });
    await db.portfolioProject.create({
      data: { businessId: business.id, title: 'J', approvalStatus: 'APPROVED', imageUrls: ['https://cdn.test/b.jpg'] },
    });

    const posts = await request(app).get('/feed?source=posts');
    expect(posts.body.items).toHaveLength(1);
    expect(posts.body.items[0].kind).toBe('POST');

    const projects = await request(app).get('/feed?source=projects');
    expect(projects.body.items).toHaveLength(1);
    expect(projects.body.items[0].kind).toBe('PROJECT');
  });

  test('excludes pending/rejected projects and posts', async () => {
    const { business } = await createBusiness();
    await db.portfolioProject.create({
      data: { businessId: business.id, title: 'Pending', approvalStatus: 'PENDING', imageUrls: ['https://cdn.test/x.jpg'] },
    });
    await db.inspirationPost.create({
      data: { businessId: business.id, title: 'Pending post', approvalStatus: 'PENDING', imageUrls: ['https://cdn.test/y.jpg'] },
    });
    await db.inspirationPost.create({
      data: { businessId: business.id, title: 'Rejected post', approvalStatus: 'REJECTED', imageUrls: ['https://cdn.test/z.jpg'] },
    });
    const res = await request(app).get('/feed');
    expect(res.body.items).toHaveLength(0);
  });

  test('drops photoless posts instead of shipping an empty tile', async () => {
    const { business } = await createBusiness();
    await db.inspirationPost.create({
      data: { businessId: business.id, title: 'No photos', approvalStatus: 'APPROVED', imageUrls: [] },
    });
    const res = await request(app).get('/feed');
    expect(res.body.items).toHaveLength(0);
  });

  test('filters by category across both sources', async () => {
    const { business } = await createBusiness();
    await db.portfolioProject.create({
      data: { businessId: business.id, title: 'K', category: 'Kitchen', approvalStatus: 'APPROVED', imageUrls: ['https://cdn.test/k.jpg'] },
    });
    await db.portfolioProject.create({
      data: { businessId: business.id, title: 'B', category: 'Bathroom', approvalStatus: 'APPROVED', imageUrls: ['https://cdn.test/b.jpg'] },
    });
    await db.inspirationPost.create({
      data: { businessId: business.id, title: 'BathPost', category: 'Bathroom', approvalStatus: 'APPROVED', imageUrls: ['https://cdn.test/bp.jpg'] },
    });

    const res = await request(app).get('/feed?category=Bathroom');
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((i) => i.title).sort()).toEqual(['B', 'BathPost']);
  });

  test('filters by businessId', async () => {
    const a = await createBusiness({ companyName: 'A Co' });
    const b = await createBusiness({ companyName: 'B Co', email: 'b-co@t.com' });
    await db.inspirationPost.create({
      data: { businessId: a.business.id, title: 'FromA', approvalStatus: 'APPROVED', imageUrls: ['https://cdn.test/a.jpg'] },
    });
    await db.inspirationPost.create({
      data: { businessId: b.business.id, title: 'FromB', approvalStatus: 'APPROVED', imageUrls: ['https://cdn.test/b.jpg'] },
    });

    const res = await request(app).get(`/feed?businessId=${a.business.id}`);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].title).toBe('FromA');
  });

  test('paginates posts (not photos) with hasMore', async () => {
    const { business } = await createBusiness();
    for (let i = 0; i < 5; i += 1) {
      // Each project carries two photos — pagination counts posts, so five
      // projects is five items, not ten.
      await db.portfolioProject.create({
        data: {
          businessId: business.id,
          title: `Many ${i}`,
          approvalStatus: 'APPROVED',
          imageUrls: [`https://cdn.test/p${i}a.jpg`, `https://cdn.test/p${i}b.jpg`],
        },
      });
    }

    const res = await request(app).get('/feed?limit=2&page=1');
    expect(res.body.items).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);

    const last = await request(app).get('/feed?limit=2&page=3');
    expect(last.body.items).toHaveLength(1);
    expect(last.body.hasMore).toBe(false);
  });
});
