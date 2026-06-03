const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient, createAdmin } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

// Convenience: create a business directly in PENDING so we exercise the queue.
async function pendingBusiness(email = `pending_${Math.random()}@test.com`) {
  return createBusiness({ email, approvalStatus: 'PENDING' });
}

describe('Admin approval — auth gate', () => {
  test('non-admin (BUSINESS) cannot read the queue', async () => {
    const { token } = await createBusiness();
    const res = await request(app).get('/admin/pending').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('client cannot approve a business', async () => {
    const { business } = await pendingBusiness();
    const { token } = await createClient();
    const res = await request(app)
      .post(`/admin/businesses/${business.id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('unauthenticated requests are 401', async () => {
    const res = await request(app).get('/admin/pending');
    expect(res.status).toBe(401);
  });
});

describe('Admin approval — pending queue', () => {
  test('queue lists pending businesses AND pending portfolio projects', async () => {
    const { business: pendingBiz } = await pendingBusiness('a@test.com');
    const { business: approvedBiz } = await createBusiness({ email: 'b@test.com' }); // APPROVED by helper default
    // A pending project on the approved business
    const proj = await db.portfolioProject.create({
      data: { businessId: approvedBiz.id, title: 'Awaiting review' },
    });
    // An already-approved project that should NOT show up
    await db.portfolioProject.create({
      data: { businessId: approvedBiz.id, title: 'Already live', approvalStatus: 'APPROVED' },
    });

    const { token } = await createAdmin();
    const res = await request(app).get('/admin/pending').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.businesses).toHaveLength(1);
    expect(res.body.businesses[0].id).toBe(pendingBiz.id);
    // The pending business carries the owner's contact info for the admin UI.
    expect(res.body.businesses[0].user.email).toBe('a@test.com');
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0].id).toBe(proj.id);
    expect(res.body.projects[0].business.companyName).toBeDefined();
  });
});

describe('Admin approval — decisions', () => {
  test('approving a business stamps reviewedAt and makes it public', async () => {
    const { business } = await pendingBusiness();
    const { token } = await createAdmin();

    // Before approval: hidden from public search.
    const before = await request(app).get('/businesses');
    expect(before.body.businesses.find((b) => b.id === business.id)).toBeUndefined();

    const res = await request(app)
      .post(`/admin/businesses/${business.id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.approvalStatus).toBe('APPROVED');
    expect(res.body.reviewedAt).not.toBeNull();
    expect(res.body.rejectionReason).toBeNull();

    const after = await request(app).get('/businesses');
    expect(after.body.businesses.find((b) => b.id === business.id)).toBeDefined();
  });

  test('rejecting a business records the reason', async () => {
    const { business } = await pendingBusiness();
    const { token } = await createAdmin();
    const res = await request(app)
      .post(`/admin/businesses/${business.id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Missing license number' });
    expect(res.status).toBe(200);
    expect(res.body.approvalStatus).toBe('REJECTED');
    expect(res.body.rejectionReason).toBe('Missing license number');
  });

  test('re-approving a previously rejected business clears the reason', async () => {
    const { business } = await pendingBusiness();
    const { token } = await createAdmin();
    await request(app).post(`/admin/businesses/${business.id}/reject`)
      .set('Authorization', `Bearer ${token}`).send({ reason: 'Try again' });
    const res = await request(app).post(`/admin/businesses/${business.id}/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.approvalStatus).toBe('APPROVED');
    expect(res.body.rejectionReason).toBeNull();
  });

  test('approving a portfolio project makes it visible to the public', async () => {
    const { business } = await createBusiness(); // APPROVED
    const project = await db.portfolioProject.create({
      data: { businessId: business.id, title: 'Hidden draft' },
    });
    // Pending project doesn't appear in the public portfolio list.
    const before = await request(app).get(`/businesses/${business.id}/portfolio`);
    expect(before.body).toHaveLength(0);

    const { token } = await createAdmin();
    await request(app).post(`/admin/portfolio/${project.id}/approve`)
      .set('Authorization', `Bearer ${token}`).expect(200);

    const after = await request(app).get(`/businesses/${business.id}/portfolio`);
    expect(after.body).toHaveLength(1);
    expect(after.body[0].title).toBe('Hidden draft');
  });

  test('approve on a non-existent target is 404', async () => {
    const { token } = await createAdmin();
    const res = await request(app).post('/admin/businesses/does-not-exist/approve')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('Approval gate — owner + admin visibility', () => {
  test('owner can still load their own pending profile (for preview/status)', async () => {
    const { business, token } = await pendingBusiness();
    const res = await request(app).get(`/businesses/${business.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.approvalStatus).toBe('PENDING');
  });

  test('unrelated user gets 404 on a pending profile', async () => {
    const { business } = await pendingBusiness();
    const { token } = await createClient();
    const res = await request(app).get(`/businesses/${business.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('owner sees their own pending portfolio projects in the portfolio list', async () => {
    const { business, token } = await createBusiness();
    await db.portfolioProject.create({ data: { businessId: business.id, title: 'Draft' } });
    const res = await request(app).get(`/businesses/${business.id}/portfolio`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].approvalStatus).toBe('PENDING');
  });
});
