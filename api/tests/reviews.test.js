const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

// Give a client a confirmed appointment with a business, so their review
// qualifies as "verified".
async function confirmAppointment(clientId, businessId) {
  return db.appointment.create({
    data: {
      clientId,
      businessId,
      scheduledAt: new Date(Date.now() + 86_400_000),
      status: 'CONFIRMED',
    },
  });
}

describe('Reviews', () => {
  test('a homeowner can post a review and it updates the business aggregate', async () => {
    const { token, user } = await createClient();
    const { business } = await createBusiness();

    const res = await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 4, body: 'Solid work' });

    expect(res.status).toBe(201);
    expect(res.body.rating).toBe(4);
    expect(res.body.authorId).toBe(user.id);
    expect(res.body.authorName).toBe('Test Client');
    expect(res.body.verified).toBe(false);

    const fresh = await db.business.findUnique({ where: { id: business.id } });
    expect(fresh.reviewCount).toBe(1);
    expect(fresh.averageRating).toBe(4);
  });

  test('a review from a confirmed appointment is verified', async () => {
    const { token, user } = await createClient();
    const { business } = await createBusiness();
    await confirmAppointment(user.id, business.id);

    const res = await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 5, body: 'Verified great' });

    expect(res.status).toBe(201);
    expect(res.body.verified).toBe(true);
    expect(res.body.appointmentId).toBeTruthy();
  });

  test('posting a review records a REVIEW activity for the business owner', async () => {
    const { token } = await createClient();
    const { business, user: owner } = await createBusiness();

    await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 5, body: 'Loved it' })
      .expect(201);

    const acts = await db.activity.findMany({ where: { userId: owner.id } });
    expect(acts).toHaveLength(1);
    expect(acts[0].type).toBe('REVIEW');
  });

  test('a second review for the same business is rejected with 409', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();

    await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 3 })
      .expect(201);

    const dup = await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 1 });

    expect(dup.status).toBe(409);

    const fresh = await db.business.findUnique({ where: { id: business.id } });
    expect(fresh.reviewCount).toBe(1);
  });

  test('reviewing a non-existent business returns 404', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'nope', rating: 5 });
    expect(res.status).toBe(404);
  });

  test('rating must be between 1 and 5', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();
    const res = await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 6 });
    expect(res.status).toBe(400); // zod validation -> 400
  });

  test('a business owner cannot post reviews', async () => {
    const { token } = await createBusiness();
    const { business } = await createBusiness();
    const res = await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 5 });
    expect(res.status).toBe(403);
  });

  test('GET /reviews/mine returns the caller reviews, scoped by business', async () => {
    const { token } = await createClient();
    const { business: b1 } = await createBusiness();
    const { business: b2 } = await createBusiness();

    await request(app).post('/reviews').set('Authorization', `Bearer ${token}`)
      .send({ businessId: b1.id, rating: 5 }).expect(201);
    await request(app).post('/reviews').set('Authorization', `Bearer ${token}`)
      .send({ businessId: b2.id, rating: 4 }).expect(201);

    const all = await request(app).get('/reviews/mine')
      .set('Authorization', `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body.reviews).toHaveLength(2);

    const scoped = await request(app).get(`/reviews/mine?businessId=${b1.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(scoped.body.reviews).toHaveLength(1);
    expect(scoped.body.reviews[0].businessId).toBe(b1.id);
  });

  test('an author can edit their own review and the aggregate recomputes', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();
    const created = await request(app).post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 2, body: 'Meh' });

    const res = await request(app)
      .patch(`/reviews/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 5, body: 'Came back, much better' });

    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(5);

    const fresh = await db.business.findUnique({ where: { id: business.id } });
    expect(fresh.averageRating).toBe(5);
  });

  test('a user cannot edit a review they did not write', async () => {
    const { token: a } = await createClient();
    const { token: b } = await createClient();
    const { business } = await createBusiness();
    const created = await request(app).post('/reviews')
      .set('Authorization', `Bearer ${a}`)
      .send({ businessId: business.id, rating: 3 });

    const res = await request(app)
      .patch(`/reviews/${created.body.id}`)
      .set('Authorization', `Bearer ${b}`)
      .send({ rating: 1 });
    expect(res.status).toBe(403);
  });

  test('an author can delete their review and the aggregate resets', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();
    const created = await request(app).post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 5 });

    const res = await request(app)
      .delete(`/reviews/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const fresh = await db.business.findUnique({ where: { id: business.id } });
    expect(fresh.reviewCount).toBe(0);
    expect(fresh.averageRating).toBe(0);
  });

  test('a user cannot delete a review they did not write', async () => {
    const { token: a } = await createClient();
    const { token: b } = await createClient();
    const { business } = await createBusiness();
    const created = await request(app).post('/reviews')
      .set('Authorization', `Bearer ${a}`)
      .send({ businessId: business.id, rating: 4 });

    const res = await request(app)
      .delete(`/reviews/${created.body.id}`)
      .set('Authorization', `Bearer ${b}`);
    expect(res.status).toBe(403);
  });

  test('reviews appear on the business detail response', async () => {
    const { token } = await createClient();
    const { business } = await createBusiness();
    await request(app).post('/reviews').set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 5, body: 'On the detail page' }).expect(201);

    const detail = await request(app).get(`/businesses/${business.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.reviews).toHaveLength(1);
    expect(detail.body.reviews[0].body).toBe('On the detail page');
  });

  test('requires authentication', async () => {
    const { business } = await createBusiness();
    const res = await request(app).post('/reviews').send({ businessId: business.id, rating: 5 });
    expect(res.status).toBe(401);
  });
});

describe('Review responses', () => {
  // Post a review by a client and return its id.
  async function postReview(clientToken, businessId, rating = 4, body = 'Good') {
    const res = await request(app).post('/reviews').set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId, rating, body });
    return res.body;
  }

  test('the owning business can respond, and the response appears on detail', async () => {
    const { token: clientToken, user: client } = await createClient();
    const { business, token: bizToken } = await createBusiness();
    const review = await postReview(clientToken, business.id);

    const res = await request(app)
      .put(`/reviews/${review.id}/response`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ response: 'Thanks for the kind words!' });
    expect(res.status).toBe(200);
    expect(res.body.response).toBe('Thanks for the kind words!');
    expect(res.body.respondedAt).toBeTruthy();

    // Visible on the public business detail.
    const detail = await request(app).get(`/businesses/${business.id}`)
      .set('Authorization', `Bearer ${clientToken}`);
    expect(detail.body.reviews[0].response).toBe('Thanks for the kind words!');

    // The author got notified.
    const acts = await db.activity.findMany({ where: { userId: client.id, type: 'REVIEW' } });
    expect(acts).toHaveLength(1);
  });

  test('a different business cannot respond to a review', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    const { token: otherToken } = await createBusiness({ email: 'other@test.com' });
    const review = await postReview(clientToken, business.id);

    const res = await request(app)
      .put(`/reviews/${review.id}/response`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ response: 'Not my business' });
    expect(res.status).toBe(403);
  });

  test('clients cannot respond to reviews', async () => {
    const { token: clientToken } = await createClient();
    const { business } = await createBusiness();
    const review = await postReview(clientToken, business.id);

    const res = await request(app)
      .put(`/reviews/${review.id}/response`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ response: 'I am the author, not the business' });
    expect(res.status).toBe(403);
  });

  test('an empty response is rejected', async () => {
    const { token: clientToken } = await createClient();
    const { business, token: bizToken } = await createBusiness();
    const review = await postReview(clientToken, business.id);

    const res = await request(app)
      .put(`/reviews/${review.id}/response`)
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ response: '' });
    // zod parse throws -> error handler (codebase convention)
    expect(res.status).toBe(400);
  });

  test('the business can delete its response', async () => {
    const { token: clientToken } = await createClient();
    const { business, token: bizToken } = await createBusiness();
    const review = await postReview(clientToken, business.id);
    await request(app).put(`/reviews/${review.id}/response`).set('Authorization', `Bearer ${bizToken}`)
      .send({ response: 'Will remove this' }).expect(200);

    const res = await request(app)
      .delete(`/reviews/${review.id}/response`)
      .set('Authorization', `Bearer ${bizToken}`);
    expect(res.status).toBe(200);
    expect(res.body.response).toBeNull();
    expect(res.body.respondedAt).toBeNull();
  });

  test('responding to a missing review returns 404', async () => {
    const { token: bizToken } = await createBusiness();
    const res = await request(app)
      .put('/reviews/nope/response')
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ response: 'ghost' });
    expect(res.status).toBe(404);
  });
});
