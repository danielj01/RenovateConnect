const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createAdmin } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

describe('POST /waitlist', () => {
  test('captures an email and normalizes it', async () => {
    const res = await request(app).post('/waitlist')
      .send({ email: '  Jamie@Example.COM ', source: 'estimate', context: 'Kitchen' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    const row = await db.waitlistEntry.findUnique({ where: { email: 'jamie@example.com' } });
    expect(row).not.toBeNull();
    expect(row.role).toBe('HOMEOWNER'); // default
    expect(row.source).toBe('estimate');
    expect(row.context).toBe('Kitchen');
  });

  test('is idempotent on email (re-join updates, never errors or duplicates)', async () => {
    const first = await request(app).post('/waitlist')
      .send({ email: 'dup@example.com', city: 'Oakland' });
    expect(first.status).toBe(201);

    const second = await request(app).post('/waitlist')
      .send({ email: 'dup@example.com', context: 'Bathroom' });
    expect(second.status).toBe(201);

    const rows = await db.waitlistEntry.findMany({ where: { email: 'dup@example.com' } });
    expect(rows).toHaveLength(1);
    // The second submit fills context but doesn't wipe the city from the first.
    expect(rows[0].city).toBe('Oakland');
    expect(rows[0].context).toBe('Bathroom');
  });

  test('accepts a CONTRACTOR role', async () => {
    const res = await request(app).post('/waitlist')
      .send({ email: 'pro@example.com', role: 'CONTRACTOR', city: 'Berkeley' });
    expect(res.status).toBe(201);
    const row = await db.waitlistEntry.findUnique({ where: { email: 'pro@example.com' } });
    expect(row.role).toBe('CONTRACTOR');
  });

  test('rejects an invalid email', async () => {
    const res = await request(app).post('/waitlist').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('rejects unknown fields (strict schema)', async () => {
    const res = await request(app).post('/waitlist')
      .send({ email: 'x@example.com', isAdmin: true });
    expect(res.status).toBe(400);
  });

  test('rejects an unknown role', async () => {
    const res = await request(app).post('/waitlist')
      .send({ email: 'y@example.com', role: 'INVESTOR' });
    expect(res.status).toBe(400);
  });
});

describe('GET /waitlist/admin', () => {
  test('non-admin is forbidden', async () => {
    const { token } = await createClient();
    const res = await request(app).get('/waitlist/admin')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('admin lists entries with counts, newest first, and can filter by role', async () => {
    await request(app).post('/waitlist').send({ email: 'h1@example.com' });
    await request(app).post('/waitlist').send({ email: 'h2@example.com' });
    await request(app).post('/waitlist').send({ email: 'c1@example.com', role: 'CONTRACTOR' });

    const { token } = await createAdmin();
    const all = await request(app).get('/waitlist/admin')
      .set('Authorization', `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body.counts).toEqual({ total: 3, homeowners: 2, contractors: 1 });
    expect(all.body.entries).toHaveLength(3);

    const pros = await request(app).get('/waitlist/admin?role=CONTRACTOR')
      .set('Authorization', `Bearer ${token}`);
    expect(pros.body.entries).toHaveLength(1);
    expect(pros.body.entries[0].email).toBe('c1@example.com');
  });

  test('admin CSV export returns a downloadable text/csv body', async () => {
    await request(app).post('/waitlist').send({ email: 'csv@example.com', source: 'estimate', context: 'Kitchen' });
    const { token } = await createAdmin();
    const res = await request(app).get('/waitlist/admin.csv')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/waitlist\.csv/);
    expect(res.text).toMatch(/^email,role,city,source,context,createdAt/);
    expect(res.text).toContain('csv@example.com');
  });
});
