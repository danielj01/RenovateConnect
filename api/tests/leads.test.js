const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

// Helper: create a conversation + lead between a client and a business.
async function seedLead(business, client, status = 'NEW') {
  const conversation = await db.conversation.create({
    data: { clientId: client.id, businessId: business.id },
  });
  return db.lead.create({ data: { conversationId: conversation.id, businessId: business.id, status } });
}

describe('Leads CRM', () => {
  test('business sees only its own leads', async () => {
    const a = await createBusiness({ email: 'a@test.com' });
    const b = await createBusiness({ email: 'b@test.com' });
    const { user: client } = await createClient();
    await seedLead(a.business, client);

    const resA = await request(app).get('/leads').set('Authorization', `Bearer ${a.token}`);
    expect(resA.status).toBe(200);
    expect(resA.body).toHaveLength(1);

    const resB = await request(app).get('/leads').set('Authorization', `Bearer ${b.token}`);
    expect(resB.body).toHaveLength(0);
  });

  test('leads include client contact info', async () => {
    const { business, token } = await createBusiness();
    const { user: client } = await createClient({ name: 'Jane', phone: '555-1234' });
    await seedLead(business, client);

    const res = await request(app).get('/leads').set('Authorization', `Bearer ${token}`);
    expect(res.body[0].conversation.client.name).toBe('Jane');
    expect(res.body[0].conversation.client.phone).toBe('555-1234');
  });

  test('owner can advance a lead through the pipeline', async () => {
    const { business, token } = await createBusiness();
    const { user: client } = await createClient();
    const lead = await seedLead(business, client);

    const res = await request(app)
      .patch(`/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CONVERTED', notes: 'Signed contract', estimatedValue: 20000 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONVERTED');
    expect(res.body.notes).toBe('Signed contract');
    expect(res.body.estimatedValue).toBe(20000);
  });

  test('a business cannot update another business lead', async () => {
    const a = await createBusiness({ email: 'a@test.com' });
    const b = await createBusiness({ email: 'b@test.com' });
    const { user: client } = await createClient();
    const lead = await seedLead(a.business, client);

    const res = await request(app)
      .patch(`/leads/${lead.id}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ status: 'CLOSED' });
    expect(res.status).toBe(403);
  });

  test('invalid status is rejected', async () => {
    const { business, token } = await createBusiness();
    const { user: client } = await createClient();
    const lead = await seedLead(business, client);

    const res = await request(app)
      .patch(`/leads/${lead.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'BOGUS' });
    expect(res.status).toBe(400); // zod validation -> 400
  });

  test('clients are forbidden from the leads API', async () => {
    const { token } = await createClient();
    const res = await request(app).get('/leads').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
