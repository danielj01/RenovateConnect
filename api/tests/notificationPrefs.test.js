const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness } = require('./helpers');
const { recordActivity } = require('../src/services/activity');
const { allowsType } = require('../src/services/notificationPrefs');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

describe('Notification preferences', () => {
  test('new users default every category to on', async () => {
    const { token } = await createClient();
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.notifyLeads).toBe(true);
    expect(res.body.notifyMessages).toBe(true);
    expect(res.body.notifyAppointments).toBe(true);
    expect(res.body.notifyReviews).toBe(true);
  });

  test('PATCH /auth/me updates a category and GET reflects it', async () => {
    const { token } = await createClient();

    const patch = await request(app)
      .patch('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifyMessages: false, notifyReviews: false });

    expect(patch.status).toBe(200);
    expect(patch.body.notifyMessages).toBe(false);
    expect(patch.body.notifyReviews).toBe(false);
    expect(patch.body.notifyLeads).toBe(true); // untouched

    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.notifyMessages).toBe(false);
    expect(me.body.notifyReviews).toBe(false);
  });

  test('allowsType reflects the stored preference, defaulting to true', async () => {
    const { user } = await createClient();
    expect(await allowsType(user.id, 'MESSAGE')).toBe(true);

    await db.user.update({ where: { id: user.id }, data: { notifyMessages: false } });
    expect(await allowsType(user.id, 'MESSAGE')).toBe(false);
    expect(await allowsType(user.id, 'LEAD')).toBe(true);   // still on
    expect(await allowsType(user.id, 'UNKNOWN')).toBe(true); // unmapped → permissive
    expect(await allowsType('missing-user', 'MESSAGE')).toBe(true);
  });

  test('recordActivity skips a category the recipient turned off', async () => {
    const { user } = await createClient();
    await db.user.update({ where: { id: user.id }, data: { notifyMessages: false } });

    const skipped = await recordActivity(user.id, { type: 'MESSAGE', title: 'Hi', body: 'there' });
    expect(skipped).toBeNull();

    const kept = await recordActivity(user.id, { type: 'LEAD', title: 'Lead', body: 'new' });
    expect(kept).not.toBeNull();

    const acts = await db.activity.findMany({ where: { userId: user.id } });
    expect(acts).toHaveLength(1);
    expect(acts[0].type).toBe('LEAD');
  });

  test('a review still posts but logs no activity when the owner muted reviews', async () => {
    const { token } = await createClient();
    const { business, user: owner } = await createBusiness();
    await db.user.update({ where: { id: owner.id }, data: { notifyReviews: false } });

    const res = await request(app)
      .post('/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: business.id, rating: 5, body: 'Great, but you muted me' });
    expect(res.status).toBe(201);

    // The review itself and the aggregate are unaffected by the preference.
    const fresh = await db.business.findUnique({ where: { id: business.id } });
    expect(fresh.reviewCount).toBe(1);

    // ...but no REVIEW activity was recorded for the owner.
    const acts = await db.activity.findMany({ where: { userId: owner.id } });
    expect(acts).toHaveLength(0);
  });
});
