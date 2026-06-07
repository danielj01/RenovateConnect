const request = require('supertest');
const app = require('../src/app');
const { db, resetDb } = require('./helpers');

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await db.$disconnect(); });

const sampleResult = {
  summary: 'Mid-range kitchen refresh',
  lineItems: [{ item: 'Cabinets', low: 5000, high: 12000, unit: 'lump sum' }],
  totalLow: 5000,
  totalHigh: 12000,
  currency: 'USD',
  confidence: 'medium',
  notes: 'Assumes existing layout.',
};

describe('saved-estimate handoff', () => {
  test('POST /estimations/share returns a code and GET /shared/:code reads it back', async () => {
    const share = await request(app)
      .post('/estimations/share')
      .send({ result: sampleResult, roomType: 'Kitchen' });
    expect(share.status).toBe(201);
    expect(typeof share.body.code).toBe('string');
    expect(share.body.code.length).toBeGreaterThanOrEqual(6);

    const read = await request(app).get(`/estimations/shared/${share.body.code}`);
    expect(read.status).toBe(200);
    expect(read.body.roomType).toBe('Kitchen');
    expect(read.body.result.totalHigh).toBe(12000);
  });

  test('code lookup is normalized (case-insensitive, ignores separators)', async () => {
    const share = await request(app).post('/estimations/share').send({ result: sampleResult });
    const code = share.body.code;
    const messy = `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`;
    const read = await request(app).get(`/estimations/shared/${messy}`);
    expect(read.status).toBe(200);
    expect(read.body.code).toBe(code);
  });

  test('unknown code returns 404', async () => {
    const res = await request(app).get('/estimations/shared/ZZZZ9999');
    expect(res.status).toBe(404);
  });

  test('rejects a non-object result with 400', async () => {
    const res = await request(app).post('/estimations/share').send({ result: 'not-an-object' });
    expect(res.status).toBe(400);
  });
});
