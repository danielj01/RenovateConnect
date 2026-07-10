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

  // Security: an upstream provider error (e.g. Anthropic "your credit balance
  // is too low") must never reach the client. The route lets the thrown error
  // propagate; the global handler replaces the body unless it was marked safe.
  test('an unexpected estimator failure returns a generic body, not the provider message', async () => {
    const leaky = new Error('402 your credit balance is too low — go to Plans & Billing');
    leaky.status = 400; // SDK errors carry their own status
    ai.estimateRenovationCost.mockRejectedValueOnce(leaky);

    const res = await request(app).post('/estimations/guest')
      .attach('images', Buffer.from('fake-jpeg'), 'room.jpg')
      .field('roomType', 'Kitchen');

    expect(res.body.error).not.toMatch(/credit|balance|billing/i);
    expect(res.body.error).toBe('Request could not be completed');
  });

  // A cleanly-mapped outage (httpError 503) IS surfaced — it's our own safe copy.
  test('a mapped 503 outage surfaces its safe message', async () => {
    const { httpError } = require('../src/utils/httpError');
    ai.estimateRenovationCost.mockRejectedValueOnce(
      httpError(503, 'This feature is temporarily unavailable. Please try again in a bit.')
    );

    const res = await request(app).post('/estimations/guest')
      .attach('images', Buffer.from('fake-jpeg'), 'room.jpg')
      .field('roomType', 'Kitchen');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
  });
});
