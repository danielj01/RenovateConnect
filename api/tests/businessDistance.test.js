const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

// Viewer in San Francisco.
const VIEWER = { lat: 37.7749, lng: -122.4194 };

async function approvedBusinessAt(name, lat, lng) {
  const { business } = await createBusiness({ email: `${name}@t.com`, companyName: name });
  await db.business.update({ where: { id: business.id }, data: { lat, lng } });
  return business;
}

describe('GET /businesses — near me (distance)', () => {
  test('sorts nearest-first and returns distanceMiles', async () => {
    await approvedBusinessAt('Far', 37.3382, -121.8863);   // San Jose ~42mi
    await approvedBusinessAt('Near', 37.7849, -122.4094);  // ~0.9mi

    const res = await request(app).get(`/businesses?lat=${VIEWER.lat}&lng=${VIEWER.lng}`);
    expect(res.status).toBe(200);
    expect(res.body.businesses[0].companyName).toBe('Near');
    expect(res.body.businesses[1].companyName).toBe('Far');
    expect(res.body.businesses[0].distanceMiles).toBeLessThan(res.body.businesses[1].distanceMiles);
    expect(res.body.businesses[0].distanceMiles).toBeLessThan(5);
  });

  test('radiusMiles filters out far businesses', async () => {
    await approvedBusinessAt('Far', 37.3382, -121.8863);
    await approvedBusinessAt('Near', 37.7849, -122.4094);

    const res = await request(app)
      .get(`/businesses?lat=${VIEWER.lat}&lng=${VIEWER.lng}&radiusMiles=10`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.businesses[0].companyName).toBe('Near');
  });

  test('businesses without coordinates sort last (no radius)', async () => {
    await approvedBusinessAt('Near', 37.7849, -122.4094);
    await createBusiness({ email: 'nocoords@t.com', companyName: 'NoCoords' }); // lat/lng null

    const res = await request(app).get(`/businesses?lat=${VIEWER.lat}&lng=${VIEWER.lng}`);
    expect(res.status).toBe(200);
    expect(res.body.businesses[0].companyName).toBe('Near');
    expect(res.body.businesses[res.body.businesses.length - 1].companyName).toBe('NoCoords');
    expect(res.body.businesses.find((b) => b.companyName === 'NoCoords').distanceMiles).toBeNull();
  });

  test('without lat/lng falls back to verified/rating ordering', async () => {
    await approvedBusinessAt('A', 37.7849, -122.4094);
    const res = await request(app).get('/businesses');
    expect(res.status).toBe(200);
    expect(res.body.businesses[0].distanceMiles).toBeUndefined();
  });
});
