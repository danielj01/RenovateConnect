// Covers the business-owner profile create/update routes, including the
// duplicate-profile guard (a user may own at most one Business).
const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, tokenFor } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

// A BUSINESS user that does not yet have a profile.
async function ownerWithoutProfile() {
  const user = await db.user.create({
    data: {
      email: `owner_${Date.now()}_${Math.random()}@test.com`,
      passwordHash: 'x',
      name: 'New Owner',
      role: 'BUSINESS',
    },
  });
  return { user, token: tokenFor(user) };
}

const validProfile = {
  companyName: 'Acme Renovations',
  description: 'We remodel kitchens and baths.',
  city: 'Austin',
  state: 'TX',
  zipCode: '78701',
  specialties: ['Kitchen', 'Bathroom'],
};

describe('POST /businesses', () => {
  test('creates a profile for a business owner', async () => {
    const { token } = await ownerWithoutProfile();
    const res = await request(app).post('/businesses')
      .set('Authorization', `Bearer ${token}`)
      .send(validProfile);
    expect(res.status).toBe(201);
    expect(res.body.companyName).toBe('Acme Renovations');
  });

  test('rejects a second profile with 409 instead of 500', async () => {
    const { token } = await ownerWithoutProfile();
    const first = await request(app).post('/businesses')
      .set('Authorization', `Bearer ${token}`)
      .send(validProfile);
    expect(first.status).toBe(201);

    const second = await request(app).post('/businesses')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validProfile, companyName: 'Acme Two' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already have a business profile/i);
  });
});

describe('PUT /businesses/:id', () => {
  test('owner can update their profile', async () => {
    const { token } = await ownerWithoutProfile();
    const created = await request(app).post('/businesses')
      .set('Authorization', `Bearer ${token}`)
      .send(validProfile);

    const res = await request(app).put(`/businesses/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Now also doing basements.' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Now also doing basements.');
  });

  test('a different owner cannot update someone else’s profile', async () => {
    const { token: ownerToken } = await ownerWithoutProfile();
    const created = await request(app).post('/businesses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validProfile);

    const { token: otherToken } = await ownerWithoutProfile();
    const res = await request(app).put(`/businesses/${created.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ description: 'hijack' });
    expect(res.status).toBe(403);
  });
});

describe('GET /businesses/:id — shareUrl', () => {
  test('includes a shareable profile URL ending in /b/<id>', async () => {
    const { token } = await ownerWithoutProfile();
    const created = await request(app).post('/businesses')
      .set('Authorization', `Bearer ${token}`)
      .send(validProfile);

    // Owner can fetch their own profile regardless of approval status.
    const res = await request(app).get(`/businesses/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.shareUrl).toBe('string');
    expect(res.body.shareUrl).toMatch(new RegExp(`/b/${created.body.id}$`));
  });
});
