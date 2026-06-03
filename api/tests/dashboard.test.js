const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

async function seedLead(business, client, status, estimatedValue) {
  const conversation = await db.conversation.create({
    data: { clientId: client.id, businessId: business.id },
  });
  return db.lead.create({
    data: { conversationId: conversation.id, businessId: business.id, status, estimatedValue },
  });
}

describe('Business dashboard', () => {
  test('aggregates leads, conversion rate, and pipeline value', async () => {
    const { business, token } = await createBusiness();
    const c1 = await createClient({ email: 'c1@test.com' });
    const c2 = await createClient({ email: 'c2@test.com' });
    const c3 = await createClient({ email: 'c3@test.com' });
    const c4 = await createClient({ email: 'c4@test.com' });

    await seedLead(business, c1.user, 'NEW', 5000);
    await seedLead(business, c2.user, 'CONTACTED', 8000);
    await seedLead(business, c3.user, 'CONVERTED', 20000);
    await seedLead(business, c4.user, 'CLOSED', 3000);

    const res = await request(app).get('/businesses/dashboard').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalLeads).toBe(4);
    expect(res.body.leadsByStatus).toEqual({ NEW: 1, CONTACTED: 1, CONVERTED: 1, CLOSED: 1 });
    expect(res.body.conversionRate).toBe(25); // 1 of 4
    expect(res.body.wonValue).toBe(20000);    // CONVERTED only
    expect(res.body.pipelineValue).toBe(13000); // NEW + CONTACTED (open), excludes CLOSED & CONVERTED
    expect(res.body.conversationCount).toBe(4);
  });

  test('returns zeros for a business with no leads', async () => {
    const { token } = await createBusiness();
    const res = await request(app).get('/businesses/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalLeads).toBe(0);
    expect(res.body.conversionRate).toBe(0);
  });

  test('requires a business role', async () => {
    const { token } = await createClient();
    const res = await request(app).get('/businesses/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('"dashboard" is not mistaken for a business id', async () => {
    // Without the dedicated route ordering this would 404 as a business lookup.
    const { token } = await createBusiness();
    const res = await request(app).get('/businesses/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('profileViews');
  });
});

describe('Profile view tracking', () => {
  test('viewing a business as a client increments profileViews', async () => {
    const { business } = await createBusiness();
    const { token } = await createClient();

    await request(app).get(`/businesses/${business.id}`).set('Authorization', `Bearer ${token}`);
    // The increment is fire-and-forget; poll briefly.
    let views = 0;
    for (let i = 0; i < 20 && views === 0; i++) {
      const b = await db.business.findUnique({ where: { id: business.id } });
      views = b.profileViews;
      if (views === 0) await new Promise(r => setTimeout(r, 25));
    }
    expect(views).toBe(1);
  });

  test('the owner viewing their own profile does NOT increment views', async () => {
    const { business, token } = await createBusiness();
    await request(app).get(`/businesses/${business.id}`).set('Authorization', `Bearer ${token}`);
    await new Promise(r => setTimeout(r, 150));
    const b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.profileViews).toBe(0);
  });
});

describe('Search impression tracking', () => {
  test('appearing in a search results page increments searchImpressions', async () => {
    const { business } = await createBusiness();

    await request(app).get('/businesses').expect(200);

    // Fire-and-forget increment; poll briefly.
    let impressions = 0;
    for (let i = 0; i < 20 && impressions === 0; i++) {
      const b = await db.business.findUnique({ where: { id: business.id } });
      impressions = b.searchImpressions;
      if (impressions === 0) await new Promise(r => setTimeout(r, 25));
    }
    expect(impressions).toBe(1);
  });

  test('a business filtered OUT of results is not counted', async () => {
    const { business } = await createBusiness(); // specialties: ['Kitchen']
    await request(app).get('/businesses?specialty=Roofing').expect(200);
    await new Promise(r => setTimeout(r, 150));
    const b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.searchImpressions).toBe(0);
  });

  test('dashboard reports searchImpressions', async () => {
    const { business, token } = await createBusiness();
    await db.business.update({ where: { id: business.id }, data: { searchImpressions: 7 } });
    const res = await request(app).get('/businesses/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.body.searchImpressions).toBe(7);
  });
});
