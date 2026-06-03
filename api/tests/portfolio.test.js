const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

describe('Portfolio', () => {
  test('owner can create a portfolio project', async () => {
    const { business, token } = await createBusiness();
    const res = await request(app)
      .post(`/businesses/${business.id}/portfolio`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Modern Kitchen', category: 'Kitchen', costMin: 15000, costMax: 25000, durationWeeks: 4 });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Modern Kitchen');
    expect(res.body.businessId).toBe(business.id);
  });

  test('rejects creation without auth', async () => {
    const { business } = await createBusiness();
    const res = await request(app)
      .post(`/businesses/${business.id}/portfolio`)
      .send({ title: 'No Auth' });
    expect(res.status).toBe(401);
  });

  test('a business cannot add projects to another business', async () => {
    const a = await createBusiness({ email: 'a@test.com' });
    const b = await createBusiness({ email: 'b@test.com' });
    const res = await request(app)
      .post(`/businesses/${a.business.id}/portfolio`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ title: 'Sneaky' });
    expect(res.status).toBe(403);
  });

  test('clients cannot create projects (role gate)', async () => {
    const { business } = await createBusiness();
    const { token } = await createClient();
    const res = await request(app)
      .post(`/businesses/${business.id}/portfolio`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Nope' });
    expect(res.status).toBe(403);
  });

  test('validation: title is required', async () => {
    const { business, token } = await createBusiness();
    const res = await request(app)
      .post(`/businesses/${business.id}/portfolio`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Kitchen' });
    expect(res.status).toBe(400); // zod validation -> 400
  });

  test('public can list projects, featured first', async () => {
    const { business } = await createBusiness();
    await db.portfolioProject.create({ data: { businessId: business.id, title: 'Old', featured: false, approvalStatus: 'APPROVED' } });
    await db.portfolioProject.create({ data: { businessId: business.id, title: 'Star', featured: true, approvalStatus: 'APPROVED' } });

    const res = await request(app).get(`/businesses/${business.id}/portfolio`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe('Star');
  });

  test('owner can update and delete a project', async () => {
    const { business, token } = await createBusiness();
    const project = await db.portfolioProject.create({ data: { businessId: business.id, title: 'Draft' } });

    const upd = await request(app)
      .put(`/businesses/${business.id}/portfolio/${project.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Published', featured: true });
    expect(upd.status).toBe(200);
    expect(upd.body.title).toBe('Published');
    expect(upd.body.featured).toBe(true);

    const del = await request(app)
      .delete(`/businesses/${business.id}/portfolio/${project.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(await db.portfolioProject.count()).toBe(0);
  });

  test('portfolio is embedded in the public business detail', async () => {
    const { business } = await createBusiness();
    await db.portfolioProject.create({ data: { businessId: business.id, title: 'Showcase', approvalStatus: 'APPROVED' } });
    const res = await request(app).get(`/businesses/${business.id}`);
    expect(res.status).toBe(200);
    expect(res.body.portfolio).toHaveLength(1);
    expect(res.body.portfolio[0].title).toBe('Showcase');
  });
});
