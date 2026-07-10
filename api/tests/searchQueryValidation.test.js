// GET /businesses used to feed raw query params into parseInt/Prisma, so
// `?page=abc` and `?page=-5` 500'd and `?limit=999999` returned the whole
// table. The query is now coerced + bounded by a zod schema.
const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

describe('GET /businesses — query validation', () => {
  test('a non-numeric page is a clean 400, not a 500', async () => {
    const res = await request(app).get('/businesses?page=abc');
    expect(res.status).toBe(400);
  });

  test('a negative page is a clean 400', async () => {
    const res = await request(app).get('/businesses?page=-5');
    expect(res.status).toBe(400);
  });

  test('limit is capped so a huge value cannot dump the table', async () => {
    // Seed a handful of businesses and ask for a million.
    for (let i = 0; i < 6; i += 1) {
      await createBusiness({ email: `q${i}@t.com`, companyName: `Q${i}` });
    }
    const res = await request(app).get('/businesses?limit=999999');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBeLessThanOrEqual(50);
    expect(res.body.businesses.length).toBeLessThanOrEqual(50);
  });

  test('an array-valued param is rejected rather than throwing', async () => {
    // Express parses ?state=a&state=b into an array; the old code called
    // .toUpperCase() on it and 500'd.
    const res = await request(app).get('/businesses?state=CA&state=TX');
    expect(res.status).toBe(400);
  });

  test('a valid default request still works', async () => {
    await createBusiness({ email: 'ok@t.com', companyName: 'OkCo' });
    const res = await request(app).get('/businesses');
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
  });
});
