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

describe('Sponsored performance metrics', () => {
  // The impression/click increments are fire-and-forget; give the event loop a
  // beat before asserting.
  const settle = () => new Promise((r) => setTimeout(r, 50));

  test('appearing in the sponsored slot counts a sponsoredImpression (organic listings unaffected)', async () => {
    const pro = await proBusiness('ImpressionPro');
    const { business: plain } = await createBusiness({ email: 'imp-plain@t.com', companyName: 'ImpPlain' });

    const res = await request(app).get('/businesses');
    expect(res.status).toBe(200);
    await settle();

    const proAfter = await db.business.findUnique({ where: { id: pro.id } });
    expect(proAfter.sponsoredImpressions).toBe(1);
    // The pro listing also appeared organically — organic impressions track separately.
    expect(proAfter.searchImpressions).toBe(1);

    const plainAfter = await db.business.findUnique({ where: { id: plain.id } });
    expect(plainAfter.sponsoredImpressions).toBe(0);
    expect(plainAfter.searchImpressions).toBe(1);
  });

  test('opening a profile with ?source=sponsored counts a click AND a profile view', async () => {
    const pro = await proBusiness('ClickPro');

    const res = await request(app).get(`/businesses/${pro.id}?source=sponsored`);
    expect(res.status).toBe(200);
    await settle();

    const after = await db.business.findUnique({ where: { id: pro.id } });
    expect(after.sponsoredClicks).toBe(1);
    expect(after.profileViews).toBe(1);
  });

  test('a plain profile open does not count a sponsored click', async () => {
    const pro = await proBusiness('PlainOpenPro');
    await request(app).get(`/businesses/${pro.id}`);
    await settle();

    const after = await db.business.findUnique({ where: { id: pro.id } });
    expect(after.sponsoredClicks).toBe(0);
    expect(after.profileViews).toBe(1);
  });

  test('dashboard reports sponsored impressions, clicks, and a server-computed CTR', async () => {
    const { user, business, token } = await createBusiness({ email: 'dash@t.com', companyName: 'DashCo' });
    await db.business.update({
      where: { id: business.id },
      data: { proStatus: 'active', sponsoredImpressions: 200, sponsoredClicks: 9 },
    });

    const res = await request(app).get('/businesses/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sponsoredImpressions).toBe(200);
    expect(res.body.sponsoredClicks).toBe(9);
    expect(res.body.sponsoredCtr).toBe(4.5);
    expect(user.id).toBeTruthy();
  });

  test('CTR is 0 when there are no sponsored impressions', async () => {
    const { token } = await createBusiness({ email: 'dash0@t.com', companyName: 'Dash0' });
    const res = await request(app).get('/businesses/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.sponsoredCtr).toBe(0);
  });
});
