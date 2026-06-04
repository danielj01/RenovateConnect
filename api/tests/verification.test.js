const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness, createAdmin } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

describe('Business verification (trust badge)', () => {
  test('a new business is unverified by default', async () => {
    const { business } = await createBusiness();
    expect(business.verified).toBe(false);
    expect(business.verifiedAt).toBeNull();
  });

  test('an admin can verify a business and it stamps verifiedAt', async () => {
    const { business } = await createBusiness();
    const { token } = await createAdmin();

    const res = await request(app)
      .patch(`/businesses/${business.id}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ verified: true });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.verifiedAt).not.toBeNull();
  });

  test('an admin can un-verify a business and clears verifiedAt', async () => {
    const { business } = await createBusiness();
    const { token } = await createAdmin();

    await request(app).patch(`/businesses/${business.id}/verify`)
      .set('Authorization', `Bearer ${token}`).send({ verified: true }).expect(200);

    const res = await request(app).patch(`/businesses/${business.id}/verify`)
      .set('Authorization', `Bearer ${token}`).send({ verified: false });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.verifiedAt).toBeNull();
  });

  test('verified state is exposed via GET /businesses/:id', async () => {
    const { business } = await createBusiness();
    const { token } = await createAdmin();
    await request(app).patch(`/businesses/${business.id}/verify`)
      .set('Authorization', `Bearer ${token}`).send({ verified: true }).expect(200);

    const res = await request(app).get(`/businesses/${business.id}`);
    expect(res.body.verified).toBe(true);
    expect(res.body.verifiedAt).not.toBeNull();
  });

  test('verified state is exposed in search results', async () => {
    const { business } = await createBusiness({ companyName: 'Verified Co' });
    const { token } = await createAdmin();
    await request(app).patch(`/businesses/${business.id}/verify`)
      .set('Authorization', `Bearer ${token}`).send({ verified: true }).expect(200);

    const res = await request(app).get('/businesses');
    const found = res.body.businesses.find((b) => b.id === business.id);
    expect(found.verified).toBe(true);
  });

  test('verified businesses are ranked ahead of unverified ones', async () => {
    // A higher-rated but unverified business should still sort below a verified
    // one — verification, not rating, is the primary sort key.
    const { business: unverified } = await createBusiness({ companyName: 'Unverified Co' });
    const { business: verified } = await createBusiness({ companyName: 'Verified Co' });
    await db.business.update({ where: { id: unverified.id }, data: { averageRating: 5 } });
    await db.business.update({
      where: { id: verified.id },
      data: { verified: true, verifiedAt: new Date(), averageRating: 3 },
    });

    const res = await request(app).get('/businesses');
    const ids = res.body.businesses.map((b) => b.id);
    expect(ids.indexOf(verified.id)).toBeLessThan(ids.indexOf(unverified.id));
  });

  test('a business owner cannot verify themselves', async () => {
    const { business, token } = await createBusiness();
    const res = await request(app)
      .patch(`/businesses/${business.id}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({ verified: true });
    expect(res.status).toBe(403);
  });

  test('a client cannot verify a business', async () => {
    const { business } = await createBusiness();
    const { token } = await createClient();
    await request(app).patch(`/businesses/${business.id}/verify`)
      .set('Authorization', `Bearer ${token}`).send({ verified: true }).expect(403);
  });

  test('verification requires authentication', async () => {
    const { business } = await createBusiness();
    await request(app).patch(`/businesses/${business.id}/verify`).send({ verified: true }).expect(401);
  });

  test('verifying a non-existent business returns 404', async () => {
    const { token } = await createAdmin();
    await request(app).patch('/businesses/nope/verify')
      .set('Authorization', `Bearer ${token}`).send({ verified: true }).expect(404);
  });

  test('rejects a missing/invalid verified field', async () => {
    const { business } = await createBusiness();
    const { token } = await createAdmin();
    const res = await request(app).patch(`/businesses/${business.id}/verify`)
      .set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400); // zod validation -> 400
  });
});
