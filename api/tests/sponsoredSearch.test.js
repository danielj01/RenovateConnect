const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

// The slot above organic is earned by an active Boost purchase (boostedUntil
// in the future), not by the subscription. The wire name "sponsored" is kept
// for client compat; the UI labels it "Boosted".
async function boostedBusiness(name) {
  const { business } = await createBusiness({ email: `${name}@t.com`, companyName: name });
  await db.business.update({
    where: { id: business.id },
    data: { boostedUntil: new Date(Date.now() + 7 * 86400000) },
  });
  return business;
}

describe('GET /businesses — boosted slot', () => {
  test('returns boosted businesses in a separate sponsored array, without reordering organic', async () => {
    await createBusiness({ email: 'plain@t.com', companyName: 'Plain' });
    const boosted = await boostedBusiness('BoostCo');

    const res = await request(app).get('/businesses');
    expect(res.status).toBe(200);
    // The slot contains the boosted business, flagged.
    expect(res.body.sponsored.map((b) => b.companyName)).toContain('BoostCo');
    expect(res.body.sponsored.every((b) => b.sponsored === true)).toBe(true);
    // Organic still lists everyone (the slot does not remove from organic).
    expect(res.body.businesses.length).toBe(2);
    // Non-boosted never appears in the slot.
    expect(res.body.sponsored.find((b) => b.companyName === 'Plain')).toBeUndefined();
    expect(boosted.id).toBeTruthy();
  });

  test('a subscription alone does NOT earn the slot', async () => {
    const { business } = await createBusiness({ email: 'subonly@t.com', companyName: 'SubOnly' });
    await db.business.update({ where: { id: business.id }, data: { proStatus: 'active' } });
    const res = await request(app).get('/businesses');
    expect(res.body.sponsored).toEqual([]);
  });

  test('an expired boost does not earn the slot', async () => {
    const { business } = await createBusiness({ email: 'expired@t.com', companyName: 'Expired' });
    await db.business.update({
      where: { id: business.id },
      data: { boostedUntil: new Date(Date.now() - 1000) },
    });
    const res = await request(app).get('/businesses');
    expect(res.body.sponsored).toEqual([]);
  });

  test('slot only appears on the first page', async () => {
    await boostedBusiness('BoostCo');
    const res = await request(app).get('/businesses?page=2');
    expect(res.body.sponsored).toEqual([]);
  });

  test('respects the specialty filter', async () => {
    const { business } = await createBusiness({ email: 'roof@t.com', companyName: 'Roofer', specialties: ['Roofing'] });
    await db.business.update({
      where: { id: business.id },
      data: { boostedUntil: new Date(Date.now() + 7 * 86400000) },
    });
    await boostedBusiness('KitchenBoost'); // default specialty Kitchen

    const res = await request(app).get('/businesses?specialty=Roofing');
    expect(res.body.sponsored.map((b) => b.companyName)).toEqual(['Roofer']);
  });
});

describe('Boosted-slot performance metrics', () => {
  // The impression/click increments are fire-and-forget; give the event loop a
  // beat before asserting.
  const settle = () => new Promise((r) => setTimeout(r, 50));

  test('appearing in the slot counts a sponsoredImpression (organic listings unaffected)', async () => {
    const boosted = await boostedBusiness('ImpressionBoost');
    const { business: plain } = await createBusiness({ email: 'imp-plain@t.com', companyName: 'ImpPlain' });

    const res = await request(app).get('/businesses');
    expect(res.status).toBe(200);
    await settle();

    const boostedAfter = await db.business.findUnique({ where: { id: boosted.id } });
    expect(boostedAfter.sponsoredImpressions).toBe(1);
    // The boosted listing also appeared organically — organic impressions track separately.
    expect(boostedAfter.searchImpressions).toBe(1);

    const plainAfter = await db.business.findUnique({ where: { id: plain.id } });
    expect(plainAfter.sponsoredImpressions).toBe(0);
    expect(plainAfter.searchImpressions).toBe(1);
  });

  test('opening a profile with ?source=sponsored counts a click AND a profile view', async () => {
    const boosted = await boostedBusiness('ClickBoost');

    const res = await request(app).get(`/businesses/${boosted.id}?source=sponsored`);
    expect(res.status).toBe(200);
    await settle();

    const after = await db.business.findUnique({ where: { id: boosted.id } });
    expect(after.sponsoredClicks).toBe(1);
    expect(after.profileViews).toBe(1);
  });

  test('a plain profile open does not count a sponsored click', async () => {
    const boosted = await boostedBusiness('PlainOpenBoost');
    await request(app).get(`/businesses/${boosted.id}`);
    await settle();

    const after = await db.business.findUnique({ where: { id: boosted.id } });
    expect(after.sponsoredClicks).toBe(0);
    expect(after.profileViews).toBe(1);
  });

  test('dashboard reports slot impressions, clicks, and a server-computed CTR', async () => {
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

  test('CTR is 0 when there are no slot impressions', async () => {
    const { token } = await createBusiness({ email: 'dash0@t.com', companyName: 'Dash0' });
    const res = await request(app).get('/businesses/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.sponsoredCtr).toBe(0);
  });
});
