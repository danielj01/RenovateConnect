// Native Inspiration posts: a contractor publishing straight to the feed.
// Covers the owner CRUD surface, the moderation gate (posts start PENDING and
// re-enter it on edit), ownership isolation, and the admin decisions.

const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient, createAdmin } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

function post(businessId) {
  return `/businesses/${businessId}/inspiration`;
}

describe('Inspiration post CRUD', () => {
  test('a contractor creates a post and it starts PENDING (invisible in the feed)', async () => {
    const { business, token } = await createBusiness();
    const res = await request(app)
      .post(post(business.id))
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Walnut vanity',
        caption: 'Floating walnut vanity with a quartz top.',
        category: 'Bathroom',
        costMin: 4000,
        costMax: 7000,
        imageUrls: ['https://cdn.test/v1.jpg', 'https://cdn.test/v2.jpg'],
      });

    expect(res.status).toBe(201);
    expect(res.body.approvalStatus).toBe('PENDING');
    expect(res.body.imageUrls).toHaveLength(2);

    const feed = await request(app).get('/feed');
    expect(feed.body.items).toHaveLength(0);
  });

  test('an approved post is served by the feed as a slideshow item', async () => {
    const { business, token } = await createBusiness({ companyName: 'Slide Co' });
    const created = await request(app)
      .post(post(business.id))
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Tile day', imageUrls: ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg'] });

    const { token: adminToken } = await createAdmin();
    const decision = await request(app)
      .post(`/admin/inspiration/${created.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(decision.status).toBe(200);
    expect(decision.body.approvalStatus).toBe('APPROVED');
    expect(decision.body.reviewedAt).toBeTruthy();

    const feed = await request(app).get('/feed');
    expect(feed.body.items).toHaveLength(1);
    expect(feed.body.items[0].kind).toBe('POST');
    expect(feed.body.items[0].slideCount).toBe(2);
    expect(feed.body.items[0].business.companyName).toBe('Slide Co');
  });

  test('editing an approved post sends it back to PENDING', async () => {
    const { business, token } = await createBusiness();
    const created = await db.inspirationPost.create({
      data: {
        businessId: business.id,
        title: 'Approved',
        approvalStatus: 'APPROVED',
        reviewedAt: new Date(),
        imageUrls: ['https://cdn.test/a.jpg'],
      },
    });

    const res = await request(app)
      .put(`${post(business.id)}/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Swapped in something else entirely' });

    expect(res.status).toBe(200);
    expect(res.body.approvalStatus).toBe('PENDING');
    expect(res.body.reviewedAt).toBeNull();

    const feed = await request(app).get('/feed');
    expect(feed.body.items).toHaveLength(0);
  });

  test('a rejected post carries the reason back to its owner', async () => {
    const { business, token } = await createBusiness();
    const created = await db.inspirationPost.create({
      data: { businessId: business.id, title: 'Nope', imageUrls: ['https://cdn.test/a.jpg'] },
    });
    const { token: adminToken } = await createAdmin();
    await request(app)
      .post(`/admin/inspiration/${created.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Photo is a stock image.' });

    const mine = await request(app)
      .get(post(business.id))
      .set('Authorization', `Bearer ${token}`);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].approvalStatus).toBe('REJECTED');
    expect(mine.body[0].rejectionReason).toBe('Photo is a stock image.');
  });

  test('the owner sees pending posts in the list; the public does not', async () => {
    const { business, token } = await createBusiness();
    await db.inspirationPost.create({
      data: { businessId: business.id, title: 'Pending', imageUrls: ['https://cdn.test/a.jpg'] },
    });
    await db.inspirationPost.create({
      data: {
        businessId: business.id, title: 'Live', approvalStatus: 'APPROVED',
        imageUrls: ['https://cdn.test/b.jpg'],
      },
    });

    const owner = await request(app).get(post(business.id)).set('Authorization', `Bearer ${token}`);
    expect(owner.body).toHaveLength(2);

    const anon = await request(app).get(post(business.id));
    expect(anon.body).toHaveLength(1);
    expect(anon.body[0].title).toBe('Live');
  });

  test("another contractor cannot post to, edit, or delete someone else's feed", async () => {
    const { business } = await createBusiness({ companyName: 'Owner Co' });
    const stranger = await createBusiness({ companyName: 'Stranger Co', email: 'stranger@t.com' });
    const mine = await db.inspirationPost.create({
      data: { businessId: business.id, title: 'Mine', imageUrls: ['https://cdn.test/a.jpg'] },
    });

    const create = await request(app)
      .post(post(business.id))
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ title: 'Hijack' });
    expect(create.status).toBe(403);

    const edit = await request(app)
      .put(`${post(business.id)}/${mine.id}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ title: 'Hijack' });
    expect(edit.status).toBe(403);

    const del = await request(app)
      .delete(`${post(business.id)}/${mine.id}`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(del.status).toBe(403);
  });

  test("a post id from another business 404s rather than editing across owners", async () => {
    const owner = await createBusiness({ companyName: 'A Co' });
    const other = await createBusiness({ companyName: 'B Co', email: 'other@t.com' });
    const theirs = await db.inspirationPost.create({
      data: { businessId: other.business.id, title: 'Theirs', imageUrls: ['https://cdn.test/a.jpg'] },
    });

    const res = await request(app)
      .put(`${post(owner.business.id)}/${theirs.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Reaching across' });
    expect(res.status).toBe(404);
  });

  test('homeowners cannot post to the inspiration feed', async () => {
    const { business } = await createBusiness();
    const { token } = await createClient();
    const res = await request(app)
      .post(post(business.id))
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Homeowner post' });
    expect(res.status).toBe(403);
  });

  test('deleting a post removes it from the feed', async () => {
    const { business, token } = await createBusiness();
    const created = await db.inspirationPost.create({
      data: {
        businessId: business.id, title: 'Live', approvalStatus: 'APPROVED',
        imageUrls: ['https://cdn.test/a.jpg'],
      },
    });
    expect((await request(app).get('/feed')).body.items).toHaveLength(1);

    const res = await request(app)
      .delete(`${post(business.id)}/${created.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((await request(app).get('/feed')).body.items).toHaveLength(0);
  });

  test('removing a slide by url is idempotent', async () => {
    const { business, token } = await createBusiness();
    const created = await db.inspirationPost.create({
      data: {
        businessId: business.id, title: 'Slides',
        imageUrls: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'],
        beforeImageUrls: ['https://cdn.test/before-a.jpg'],
      },
    });

    const first = await request(app)
      .delete(`${post(business.id)}/${created.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://cdn.test/a.jpg' });
    expect(first.status).toBe(200);
    expect(first.body.imageUrls).toEqual(['https://cdn.test/b.jpg']);

    const again = await request(app)
      .delete(`${post(business.id)}/${created.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://cdn.test/a.jpg' });
    expect(again.status).toBe(200);
    expect(again.body.imageUrls).toEqual(['https://cdn.test/b.jpg']);
  });

  test('pending posts show up in the admin queue', async () => {
    const { business } = await createBusiness({ companyName: 'Queue Co' });
    await db.inspirationPost.create({
      data: { businessId: business.id, title: 'Review me', imageUrls: ['https://cdn.test/a.jpg'] },
    });
    const { token: adminToken } = await createAdmin();

    const res = await request(app).get('/admin/pending').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.inspirationPosts).toHaveLength(1);
    expect(res.body.inspirationPosts[0].title).toBe('Review me');
    expect(res.body.inspirationPosts[0].business.companyName).toBe('Queue Co');
  });

  test("a lapsed business's approved posts leave the feed with it", async () => {
    const { business } = await createBusiness({
      freeListingEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await db.inspirationPost.create({
      data: {
        businessId: business.id, title: 'Hidden', approvalStatus: 'APPROVED',
        imageUrls: ['https://cdn.test/a.jpg'],
      },
    });
    const res = await request(app).get('/feed');
    expect(res.body.items).toHaveLength(0);
  });
});
