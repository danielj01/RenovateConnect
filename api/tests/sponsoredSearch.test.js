const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

async function proBusiness(name) {
  const { business } = await createBusiness({ email: `${name}@t.com`, companyName: name });
  await db.business.update({ where: { id: business.id }, data: { proStatus: 'trialing' } });
  return business;
}

describe('GET /businesses — sponsored slot', () => {
  test('returns Pro businesses in a separate sponsored array, without reordering organic', async () => {
    await createBusiness({ email: 'plain@t.com', companyName: 'Plain' });
    const pro = await proBusiness('ProCo');

    const res = await request(app).get('/businesses');
    expect(res.status).toBe(200);
    // Sponsored contains the Pro business, flagged.
    expect(res.body.sponsored.map((b) => b.companyName)).toContain('ProCo');
    expect(res.body.sponsored.every((b) => b.sponsored === true)).toBe(true);
    // Organic still lists everyone (sponsored does not remove from organic).
    expect(res.body.businesses.length).toBe(2);
    // Non-pro never appears in sponsored.
    expect(res.body.sponsored.find((b) => b.companyName === 'Plain')).toBeUndefined();
    expect(pro.id).toBeTruthy();
  });

  test('no Pro businesses → empty sponsored array', async () => {
    await createBusiness({ email: 'plain2@t.com', companyName: 'Plain2' });
    const res = await request(app).get('/businesses');
    expect(res.body.sponsored).toEqual([]);
  });

  test('sponsored only appears on the first page', async () => {
    await proBusiness('ProCo');
    const res = await request(app).get('/businesses?page=2');
    expect(res.body.sponsored).toEqual([]);
  });

  test('respects the specialty filter', async () => {
    const { business } = await createBusiness({ email: 'roof@t.com', companyName: 'Roofer', specialties: ['Roofing'] });
    await db.business.update({ where: { id: business.id }, data: { proStatus: 'active' } });
    await proBusiness('KitchenPro'); // default specialty Kitchen

    const res = await request(app).get('/businesses?specialty=Roofing');
    expect(res.body.sponsored.map((b) => b.companyName)).toEqual(['Roofer']);
  });
});
