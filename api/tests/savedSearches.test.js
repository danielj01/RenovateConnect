const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness } = require('./helpers');
const { matches, notifyMatchingSearches } = require('../src/services/savedSearch');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

// A valid profile body for POST /businesses (triggers the alert path).
function profileBody(overrides = {}) {
  return {
    companyName: 'Bright Kitchens',
    description: 'We remodel kitchens.',
    city: 'Austin',
    state: 'TX',
    zipCode: '78701',
    specialties: ['Kitchen'],
    ...overrides,
  };
}

describe('Saved searches — CRUD', () => {
  test('create requires at least one criterion', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/saved-searches')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empty' });
    // zod refine throws -> error handler (codebase convention)
    expect(res.status).toBe(400);
  });

  test('create, list, and delete a saved search', async () => {
    const { token } = await createClient();

    const created = await request(app)
      .post('/saved-searches')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Kitchen pros', specialty: 'Kitchen', city: 'Austin', state: 'tx' });
    expect(created.status).toBe(201);
    expect(created.body.specialty).toBe('Kitchen');
    expect(created.body.state).toBe('TX'); // normalized to uppercase

    const list = await request(app)
      .get('/saved-searches')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const del = await request(app)
      .delete(`/saved-searches/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const after = await request(app)
      .get('/saved-searches')
      .set('Authorization', `Bearer ${token}`);
    expect(after.body).toHaveLength(0);
  });

  test('only the owner sees their searches; delete is owner-scoped', async () => {
    const a = await createClient();
    const b = await createClient();

    const created = await request(app)
      .post('/saved-searches')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ specialty: 'Roofing' });
    expect(created.status).toBe(201);

    // B can't see A's search...
    const bList = await request(app)
      .get('/saved-searches')
      .set('Authorization', `Bearer ${b.token}`);
    expect(bList.body).toHaveLength(0);

    // ...and B deleting A's id is a no-op (still 204), leaving it intact.
    const del = await request(app)
      .delete(`/saved-searches/${created.body.id}`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(del.status).toBe(204);

    const aList = await request(app)
      .get('/saved-searches')
      .set('Authorization', `Bearer ${a.token}`);
    expect(aList.body).toHaveLength(1);
  });

  test('businesses cannot manage saved searches (CLIENT-only)', async () => {
    const { token } = await createBusiness();
    const res = await request(app)
      .get('/saved-searches')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('Saved searches — matching', () => {
  test('matches honors each criterion', () => {
    const biz = { companyName: 'Bright Kitchens', specialties: ['Kitchen', 'Bath'], city: 'Austin', state: 'TX', userId: 'owner' };
    expect(matches({ specialty: 'Kitchen' }, biz)).toBe(true);
    expect(matches({ specialty: 'Roofing' }, biz)).toBe(false);
    expect(matches({ city: 'aust' }, biz)).toBe(true);   // case-insensitive substring
    expect(matches({ state: 'tx' }, biz)).toBe(true);    // case-insensitive exact
    expect(matches({ state: 'CA' }, biz)).toBe(false);
    expect(matches({ q: 'bright' }, biz)).toBe(true);
    expect(matches({ specialty: 'Kitchen', city: 'Dallas' }, biz)).toBe(false); // all must hold
  });
});

describe('Saved searches — alerts on new contractor', () => {
  test('a matching new business notifies the saver (activity + lastNotifiedAt bump)', async () => {
    const saver = await createClient();
    await request(app)
      .post('/saved-searches')
      .set('Authorization', `Bearer ${saver.token}`)
      .send({ specialty: 'Kitchen', city: 'Austin' });

    // A business owner creates a matching profile via the public route.
    const owner = await db.user.create({
      data: { email: `owner_${Date.now()}@test.com`, passwordHash: 'x', name: 'Owner', role: 'BUSINESS' },
    });
    const { tokenFor } = require('./helpers');
    const res = await request(app)
      .post('/businesses')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send(profileBody());
    expect(res.status).toBe(201);

    const acts = await db.activity.findMany({ where: { userId: saver.user.id } });
    expect(acts).toHaveLength(1);
    expect(acts[0].type).toBe('SAVED_SEARCH');
    expect(acts[0].data.businessId).toBe(res.body.id);

    const search = await db.savedSearch.findFirst({ where: { userId: saver.user.id } });
    expect(new Date(search.lastNotifiedAt).getTime()).toBeGreaterThan(new Date(search.createdAt).getTime() - 1000);
  });

  test('a non-matching new business does not notify', async () => {
    const saver = await createClient();
    await request(app)
      .post('/saved-searches')
      .set('Authorization', `Bearer ${saver.token}`)
      .send({ specialty: 'Roofing' });

    const { tokenFor } = require('./helpers');
    const owner = await db.user.create({
      data: { email: `owner2_${Date.now()}@test.com`, passwordHash: 'x', name: 'Owner', role: 'BUSINESS' },
    });
    const res = await request(app)
      .post('/businesses')
      .set('Authorization', `Bearer ${tokenFor(owner)}`)
      .send(profileBody({ specialties: ['Kitchen'] }));
    expect(res.status).toBe(201);

    const acts = await db.activity.findMany({ where: { userId: saver.user.id } });
    expect(acts).toHaveLength(0);
  });

  test('respects the recipient muting (allowsType is permissive for SAVED_SEARCH, so it still posts)', async () => {
    // SAVED_SEARCH is unmapped in notificationPrefs -> always allowed. This
    // documents the intended behavior: there's no per-category opt-out for it.
    const saver = await createClient();
    await db.user.update({ where: { id: saver.user.id }, data: { notifyMessages: false } });
    await db.savedSearch.create({ data: { userId: saver.user.id, specialty: 'Kitchen' } });

    const owner = await createBusiness({ specialties: ['Kitchen'], companyName: 'Direct Co' });
    const notified = await notifyMatchingSearches(owner.business);
    expect(notified).toBe(1);

    const acts = await db.activity.findMany({ where: { userId: saver.user.id } });
    expect(acts).toHaveLength(1);
  });

  test('does not notify the business owner about their own profile', async () => {
    // An owner who also saved a search shouldn't be alerted about themselves.
    const { tokenFor } = require('./helpers');
    const owner = await db.user.create({
      data: { email: `selfowner_${Date.now()}@test.com`, passwordHash: 'x', name: 'Owner', role: 'CLIENT' },
    });
    await db.savedSearch.create({ data: { userId: owner.id, specialty: 'Kitchen' } });

    // Flip to BUSINESS and create a matching profile.
    await db.user.update({ where: { id: owner.id }, data: { role: 'BUSINESS' } });
    const res = await request(app)
      .post('/businesses')
      .set('Authorization', `Bearer ${tokenFor({ ...owner, role: 'BUSINESS' })}`)
      .send(profileBody());
    expect(res.status).toBe(201);

    const acts = await db.activity.findMany({ where: { userId: owner.id } });
    expect(acts).toHaveLength(0);
  });
});
