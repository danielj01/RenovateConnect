const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness, createAdmin } = require('./helpers');
const { checkAvailability } = require('../src/services/availability');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

// Build a future ISO timestamp landing on a specific UTC weekday/minute so
// availability assertions don't drift with the calendar.
function futureSlot(dayOfWeek, minuteOfDay) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 14);
  while (d.getUTCDay() !== dayOfWeek) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  return d.toISOString();
}

// A standard Mon–Fri 9–5 week, weekends closed.
function nineToFiveWeek() {
  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    openMinute: 540,
    closeMinute: 1020,
    closed: dayOfWeek === 0 || dayOfWeek === 6,
  }));
}

describe('Business hours — CRUD', () => {
  test('hours are empty until set', async () => {
    const { business } = await createBusiness();
    const res = await request(app).get(`/businesses/${business.id}/hours`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('an owner can set the full week and read it back sorted', async () => {
    const { token, business } = await createBusiness();
    const res = await request(app)
      .put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: nineToFiveWeek() });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(7);
    // Returned ordered Sunday→Saturday.
    expect(res.body.map((h) => h.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(res.body[0].closed).toBe(true);   // Sunday
    expect(res.body[1].closed).toBe(false);  // Monday
    expect(res.body[1].openMinute).toBe(540);
    expect(res.body[1].closeMinute).toBe(1020);
  });

  test('PUT fully replaces the previous week', async () => {
    const { token, business } = await createBusiness();
    await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: nineToFiveWeek() }).expect(200);

    // Replace with just two days.
    const res = await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: [
        { dayOfWeek: 1, openMinute: 480, closeMinute: 1080 },
        { dayOfWeek: 2, openMinute: 480, closeMinute: 1080 },
      ] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((h) => h.dayOfWeek)).toEqual([1, 2]);

    const stored = await db.businessHours.findMany({ where: { businessId: business.id } });
    expect(stored).toHaveLength(2);
  });

  test('clearing hours with an empty array is allowed', async () => {
    const { token, business } = await createBusiness();
    await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: nineToFiveWeek() }).expect(200);

    const res = await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('an admin can set hours for any business', async () => {
    const { business } = await createBusiness();
    const { token: adminToken } = await createAdmin();
    const res = await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hours: [{ dayOfWeek: 3, openMinute: 540, closeMinute: 1020 }] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('a different business owner cannot set my hours', async () => {
    const { business } = await createBusiness();
    const intruder = await createBusiness({ email: 'intruder@biz.com' });
    const res = await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .send({ hours: nineToFiveWeek() });
    expect(res.status).toBe(403);
  });

  test('a client cannot set hours', async () => {
    const { business } = await createBusiness();
    const { token: clientToken } = await createClient();
    const res = await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ hours: nineToFiveWeek() });
    expect(res.status).toBe(403);
  });

  test('setting hours requires authentication', async () => {
    const { business } = await createBusiness();
    await request(app).put(`/businesses/${business.id}/hours`)
      .send({ hours: nineToFiveWeek() }).expect(401);
  });

  test('duplicate weekdays are rejected', async () => {
    const { token, business } = await createBusiness();
    const res = await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: [
        { dayOfWeek: 1, openMinute: 540, closeMinute: 1020 },
        { dayOfWeek: 1, openMinute: 600, closeMinute: 1080 },
      ] });
    expect(res.status).toBe(422);
  });

  // Zod validation failures are mapped to a 400 by the global error handler.
  test('closeMinute must be after openMinute (validation → 400)', async () => {
    const { token, business } = await createBusiness();
    const res = await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: [{ dayOfWeek: 1, openMinute: 1020, closeMinute: 540 }] });
    expect(res.status).toBe(400);
  });

  test('out-of-range minutes are rejected (validation → 400)', async () => {
    const { token, business } = await createBusiness();
    const res = await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: [{ dayOfWeek: 1, openMinute: -1, closeMinute: 99999 }] });
    expect(res.status).toBe(400);
  });

  test('business detail embeds hours', async () => {
    const { token, business } = await createBusiness();
    await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: nineToFiveWeek() }).expect(200);

    const res = await request(app).get(`/businesses/${business.id}`);
    expect(res.status).toBe(200);
    expect(res.body.hours).toHaveLength(7);
    expect(res.body.hours[0].dayOfWeek).toBe(0);
  });

  test('deleting a business cascades to its hours', async () => {
    const { token, business } = await createBusiness();
    await request(app).put(`/businesses/${business.id}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours: nineToFiveWeek() }).expect(200);

    await db.business.delete({ where: { id: business.id } });
    const stored = await db.businessHours.findMany({ where: { businessId: business.id } });
    expect(stored).toHaveLength(0);
  });
});

describe('checkAvailability (unit)', () => {
  const week = nineToFiveWeek(); // Sun/Sat closed, Mon–Fri 9–5

  test('no configured hours allows anything', () => {
    expect(checkAvailability([], new Date(), 60).ok).toBe(true);
    expect(checkAvailability(undefined, new Date(), 60).ok).toBe(true);
  });

  test('a slot fully inside the window is ok', () => {
    // Monday 10:00 for 60 min.
    const r = checkAvailability(week, new Date(futureSlot(1, 600)), 60);
    expect(r.ok).toBe(true);
  });

  test('a slot that ends after close is rejected', () => {
    // Monday 16:40 for 60 min → ends 17:40, past 17:00.
    const r = checkAvailability(week, new Date(futureSlot(1, 1000)), 60);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('outside-hours');
  });

  test('a slot that starts before open is rejected', () => {
    // Monday 08:00.
    const r = checkAvailability(week, new Date(futureSlot(1, 480)), 60);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('outside-hours');
  });

  test('a closed weekday is rejected', () => {
    // Sunday.
    const r = checkAvailability(week, new Date(futureSlot(0, 600)), 60);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('closed');
  });

  test('a weekday with no row is treated as closed', () => {
    const onlyMonday = [{ dayOfWeek: 1, openMinute: 540, closeMinute: 1020, closed: false }];
    const r = checkAvailability(onlyMonday, new Date(futureSlot(2, 600)), 60);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('closed');
  });
});

describe('Appointment booking respects hours', () => {
  async function setHours(token, businessId, hours) {
    await request(app).put(`/businesses/${businessId}/hours`)
      .set('Authorization', `Bearer ${token}`)
      .send({ hours }).expect(200);
  }

  test('a slot inside open hours is accepted', async () => {
    const { token: bizToken, business } = await createBusiness();
    const { token: clientToken } = await createClient();
    await setHours(bizToken, business.id, nineToFiveWeek());

    const res = await request(app).post('/appointments')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: futureSlot(1, 600), durationMin: 60 });
    expect(res.status).toBe(201);
  });

  test('a slot outside open hours is rejected with 422', async () => {
    const { token: bizToken, business } = await createBusiness();
    const { token: clientToken } = await createClient();
    await setHours(bizToken, business.id, nineToFiveWeek());

    const res = await request(app).post('/appointments')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: futureSlot(1, 1000), durationMin: 60 });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/business hours/i);
  });

  test('a request on a closed day is rejected with 422', async () => {
    const { token: bizToken, business } = await createBusiness();
    const { token: clientToken } = await createClient();
    await setHours(bizToken, business.id, nineToFiveWeek());

    const res = await request(app).post('/appointments')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: futureSlot(0, 600), durationMin: 60 });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not open/i);
  });

  test('a long duration that spills past close is rejected', async () => {
    const { token: bizToken, business } = await createBusiness();
    const { token: clientToken } = await createClient();
    await setHours(bizToken, business.id, nineToFiveWeek());

    // Monday 16:00 for 120 min → ends 18:00, past 17:00.
    const res = await request(app).post('/appointments')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: futureSlot(1, 960), durationMin: 120 });
    expect(res.status).toBe(422);
  });

  test('when no hours are configured, any time is accepted', async () => {
    const { business } = await createBusiness();
    const { token: clientToken } = await createClient();
    const res = await request(app).post('/appointments')
      .set('Authorization', `Bearer ${clientToken}`)
      .send({ businessId: business.id, scheduledAt: futureSlot(0, 180), durationMin: 60 });
    expect(res.status).toBe(201);
  });
});
