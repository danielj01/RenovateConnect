const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness } = require('./helpers');
const { digestSince, isNewSince, summarizeBusiness, SAMPLE_LIMIT } = require('../src/services/favoritesDigest');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const makeProject = (businessId, createdAt, extra = {}) =>
  db.portfolioProject.create({
    data: { businessId, title: 'Project', imageUrls: [], createdAt, approvalStatus: 'APPROVED', ...extra },
  });

const makeReview = (businessId, createdAt, extra = {}) =>
  db.review.create({
    data: { businessId, authorName: 'Reviewer', rating: 5, body: 'Great work', createdAt, ...extra },
  });

// Save a contractor through the API, then backdate the favorite so content
// created "now" reliably counts as new (the favorite's createdAt is the floor).
async function saveAndBackdate(token, businessId, savedAt = daysAgo(1)) {
  await request(app).post(`/favorites/${businessId}`).set('Authorization', `Bearer ${token}`).expect(201);
  await db.favorite.updateMany({ where: { businessId }, data: { createdAt: savedAt } });
}

describe('favoritesDigest service (unit)', () => {
  test('digestSince uses the favorite save time when no watermark', () => {
    const saved = daysAgo(3);
    expect(digestSince(saved, null).getTime()).toBe(saved.getTime());
  });

  test('digestSince prefers the later of save time and watermark', () => {
    const saved = daysAgo(5);
    const seen = daysAgo(2);
    expect(digestSince(saved, seen).getTime()).toBe(seen.getTime());
    // …and the save time when it is the more recent of the two.
    const recentSave = daysAgo(1);
    expect(digestSince(recentSave, seen).getTime()).toBe(recentSave.getTime());
  });

  test('isNewSince is strict (equal timestamps are not new)', () => {
    const t = daysAgo(1);
    expect(isNewSince(t, daysAgo(2))).toBe(true);
    expect(isNewSince(t, t)).toBe(false);
    expect(isNewSince(daysAgo(3), daysAgo(1))).toBe(false);
  });

  test('summarizeBusiness counts only items after the cutoff', () => {
    const since = daysAgo(2);
    const entry = summarizeBusiness({
      business: { id: 'b1', companyName: 'Co', city: 'Austin', state: 'TX', averageRating: 4, reviewCount: 3, verified: false },
      projects: [
        { id: 'p1', title: 'New', imageUrls: [], createdAt: daysAgo(1) },
        { id: 'p0', title: 'Old', imageUrls: [], createdAt: daysAgo(5) },
      ],
      reviews: [{ id: 'r1', rating: 5, authorName: 'A', body: 'x', createdAt: daysAgo(1) }],
      since,
    });
    expect(entry.newProjectCount).toBe(1);
    expect(entry.newReviewCount).toBe(1);
    expect(entry.hasUpdates).toBe(true);
    expect(entry.newProjects[0].id).toBe('p1');
  });

  test('summarizeBusiness reports no updates when nothing is newer', () => {
    const entry = summarizeBusiness({
      business: { id: 'b1', companyName: 'Co', city: 'Austin', state: 'TX', averageRating: 0, reviewCount: 0, verified: false },
      projects: [{ id: 'p0', title: 'Old', imageUrls: [], createdAt: daysAgo(10) }],
      reviews: [],
      since: daysAgo(3),
    });
    expect(entry.hasUpdates).toBe(false);
    expect(entry.latestAt).toBeNull();
  });

  test('summarizeBusiness caps samples but keeps exact counts', () => {
    const projects = Array.from({ length: SAMPLE_LIMIT + 3 }, (_, i) => ({
      id: `p${i}`, title: `P${i}`, imageUrls: [], createdAt: daysAgo(1),
    }));
    const entry = summarizeBusiness({
      business: { id: 'b1', companyName: 'Co', city: 'Austin', state: 'TX', averageRating: 0, reviewCount: 0, verified: false },
      projects,
      reviews: [],
      since: daysAgo(2),
    });
    expect(entry.newProjectCount).toBe(SAMPLE_LIMIT + 3);
    expect(entry.newProjects).toHaveLength(SAMPLE_LIMIT);
  });
});

describe('Favorites digest API', () => {
  test('only authenticated homeowners can read the digest', async () => {
    const { token: bizToken } = await createBusiness();
    await request(app).get('/favorites/digest').expect(401);
    await request(app).get('/favorites/digest/unseen').expect(401);
    await request(app).post('/favorites/digest/seen').expect(401);
    // Businesses are not homeowners.
    await request(app).get('/favorites/digest').set('Authorization', `Bearer ${bizToken}`).expect(403);
  });

  test('a freshly saved contractor does not dump its back catalogue', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();
    await makeProject(business.id, daysAgo(5));
    await makeReview(business.id, daysAgo(4));

    // Save now (no backdating): the floor is "now", so old content is not new.
    await request(app).post(`/favorites/${business.id}`).set('Authorization', `Bearer ${token}`).expect(201);

    const res = await request(app).get('/favorites/digest').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  test('new projects and reviews since saving show up in the digest', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness({ companyName: 'Bright Builders' });
    await saveAndBackdate(token, business.id);

    // Pre-existing (before save) → not new; fresh ones → new.
    await makeProject(business.id, daysAgo(3));
    await makeProject(business.id, new Date());
    await makeReview(business.id, new Date());

    const res = await request(app).get('/favorites/digest').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].business.companyName).toBe('Bright Builders');
    expect(res.body[0].newProjectCount).toBe(1);
    expect(res.body[0].newReviewCount).toBe(1);
    expect(res.body[0].hasUpdates).toBe(true);
    expect(res.body[0].latestAt).toBeTruthy();
  });

  test('the digest is scoped to saved contractors only', async () => {
    const { token } = await createClient();
    const saved = await createBusiness({ companyName: 'Saved Co' });
    const other = await createBusiness({ companyName: 'Unsaved Co' });
    await saveAndBackdate(token, saved.business.id);

    // Both get fresh content, but only the saved one is followed.
    await makeProject(saved.business.id, new Date());
    await makeProject(other.business.id, new Date());

    const res = await request(app).get('/favorites/digest').set('Authorization', `Bearer ${token}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].business.companyName).toBe('Saved Co');
  });

  test('the digest is sorted by most recent activity first', async () => {
    const { token } = await createClient();
    const a = await createBusiness({ companyName: 'Alpha' });
    const b = await createBusiness({ companyName: 'Beta' });
    await saveAndBackdate(token, a.business.id);
    await saveAndBackdate(token, b.business.id);

    await makeProject(a.business.id, daysAgo(0.5));     // older update
    await makeProject(b.business.id, new Date());       // newer update

    const res = await request(app).get('/favorites/digest').set('Authorization', `Bearer ${token}`);
    expect(res.body.map((e) => e.business.companyName)).toEqual(['Beta', 'Alpha']);
  });

  test('unseen counts aggregate businesses and items', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();
    await saveAndBackdate(token, business.id);
    await makeProject(business.id, new Date());
    await makeReview(business.id, new Date());

    const res = await request(app).get('/favorites/digest/unseen').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ businesses: 1, items: 2 });
  });

  test('marking the digest seen advances the watermark and clears it', async () => {
    const { token, user } = await createClient();
    const { business } = await createBusiness();
    await saveAndBackdate(token, business.id);
    await makeProject(business.id, new Date());

    let res = await request(app).get('/favorites/digest').set('Authorization', `Bearer ${token}`);
    expect(res.body).toHaveLength(1);

    const seen = await request(app).post('/favorites/digest/seen').set('Authorization', `Bearer ${token}`);
    expect(seen.status).toBe(200);
    expect(seen.body.seenAt).toBeTruthy();
    const stored = await db.user.findUnique({ where: { id: user.id } });
    expect(stored.favoritesDigestSeenAt).not.toBeNull();

    // Everything created before "seen" is now considered read.
    res = await request(app).get('/favorites/digest').set('Authorization', `Bearer ${token}`);
    expect(res.body).toHaveLength(0);

    const unseen = await request(app).get('/favorites/digest/unseen').set('Authorization', `Bearer ${token}`);
    expect(unseen.body).toEqual({ businesses: 0, items: 0 });
  });

  test('content added after marking seen reappears in the digest', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();
    await saveAndBackdate(token, business.id);
    await makeProject(business.id, new Date());

    await request(app).post('/favorites/digest/seen').set('Authorization', `Bearer ${token}`).expect(200);
    // A brand-new project lands a moment later.
    await makeProject(business.id, new Date(Date.now() + 1000));

    const res = await request(app).get('/favorites/digest').set('Authorization', `Bearer ${token}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].newProjectCount).toBe(1);
  });
});
