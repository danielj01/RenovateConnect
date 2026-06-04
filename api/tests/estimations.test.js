// The AI vision call is mocked so the guest-estimate route can be tested
// deterministically without hitting Anthropic.
jest.mock('../src/services/ai', () => ({
  estimateRenovationCost: jest.fn(),
  chatWithAssistant: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const ai = require('../src/services/ai');
const { db, resetDb } = require('./helpers');

const fakeResult = {
  summary: 'Kitchen refresh',
  lineItems: [{ item: 'Cabinets', unit: 'each', low: 4000, high: 7000 }],
  totalLow: 4000,
  totalHigh: 7000,
  currency: 'USD',
  confidence: 'medium',
  notes: 'Rough guidance only.',
};

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
});
afterAll(async () => { await db.$disconnect(); });

describe('POST /estimations/guest', () => {
  test('returns an AI estimate without auth and without persisting', async () => {
    ai.estimateRenovationCost.mockResolvedValueOnce(fakeResult);

    const res = await request(app).post('/estimations/guest')
      .attach('images', Buffer.from('fake-jpeg'), 'room.jpg')
      .field('roomType', 'Kitchen');

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ summary: 'Kitchen refresh', totalLow: 4000 });
    // Nothing should be written to the estimations table for a guest.
    expect(await db.estimation.count()).toBe(0);
  });

  test('rejects a request with no images', async () => {
    const res = await request(app).post('/estimations/guest').field('roomType', 'Kitchen');
    expect(res.status).toBe(400);
    expect(ai.estimateRenovationCost).not.toHaveBeenCalled();
  });
});
