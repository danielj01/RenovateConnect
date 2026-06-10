// "Quote this look" — flagship one-tap intro from an inspiration feed photo
// to a real conversation with the contractor, with the photo + AI estimate
// pre-filled as the first message.
jest.mock('../src/services/ai', () => ({
  estimateRenovationCost: jest.fn(),
  chatWithAssistant: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const ai = require('../src/services/ai');
const { db, resetDb, createClient, createBusiness } = require('./helpers');

const fakeEstimate = {
  summary: 'Bath refresh',
  lineItems: [{ item: 'Tile', unit: 'sqft', low: 2000, high: 4000 }],
  totalLow: 8000,
  totalHigh: 14000,
  currency: 'USD',
  confidence: 'medium',
  notes: 'Rough only.',
};

// fetch() inside the route downloads our own image URL to base64. Stub it so
// the tests don't need a real HTTP server.
let originalFetch;
beforeAll(() => {
  originalFetch = global.fetch;
  global.fetch = jest.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer, // JPEG SOI
  }));
});
afterAll(() => { global.fetch = originalFetch; });

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  ai.estimateRenovationCost.mockResolvedValue(fakeEstimate);
});
afterAll(async () => { await db.$disconnect(); });

async function seedFeed({ approved = true } = {}) {
  const { user: client, token } = await createClient();
  const { business } = await createBusiness({ companyName: 'Tile Pros' });
  const portfolio = await db.portfolioProject.create({
    data: {
      businessId: business.id,
      title: 'Modern bath',
      category: 'Bathroom',
      imageUrls: ['https://cdn.example.com/uploads/after.jpg'],
      beforeImageUrls: ['https://cdn.example.com/uploads/before.jpg'],
      approvalStatus: approved ? 'APPROVED' : 'PENDING',
    },
  });
  return { client, token, business, portfolio };
}

describe('POST /feed/quote-this-look', () => {
  test('AI fallback: portfolio has no cost range → runs the estimator, opens a thread, posts a pre-filled first message', async () => {
    const { client, token, business, portfolio } = await seedFeed();

    const res = await request(app).post('/feed/quote-this-look')
      .set('Authorization', `Bearer ${token}`)
      .send({ portfolioProjectId: portfolio.id, imageUrl: portfolio.imageUrls[0] });
    expect(res.status).toBe(201);
    expect(res.body.conversationId).toBeTruthy();
    expect(res.body.estimateLow).toBe(8000);
    expect(res.body.estimateHigh).toBe(14000);
    expect(res.body.usedAi).toBe(true);
    expect(res.body.estimationId).toBeTruthy();

    // Estimator was called with the project category as roomType.
    expect(ai.estimateRenovationCost).toHaveBeenCalledTimes(1);
    expect(ai.estimateRenovationCost.mock.calls[0][0].roomType).toBe('Bathroom');

    // First message carries the image AND a body that mentions the company,
    // the portfolio title, and the AI range with the AI source attribution.
    const conv = await db.conversation.findUnique({
      where: { id: res.body.conversationId },
      include: { messages: true },
    });
    expect(conv.clientId).toBe(client.id);
    expect(conv.businessId).toBe(business.id);
    expect(conv.messages.length).toBe(1);
    const msg = conv.messages[0];
    expect(msg.imageUrls).toEqual([portfolio.imageUrls[0]]);
    expect(msg.body).toContain('Tile Pros');
    expect(msg.body).toContain('Modern bath');
    expect(msg.body).toContain('AI estimator');
    expect(msg.body).toContain('8,000');
    expect(msg.body).toContain('14,000');

    // First contact created a Lead.
    const lead = await db.lead.findFirst({ where: { conversationId: conv.id } });
    expect(lead).not.toBeNull();
  });

  test('uses the contractor-posted range and skips the AI estimator entirely', async () => {
    const { token, portfolio } = await seedFeed();
    await db.portfolioProject.update({
      where: { id: portfolio.id }, data: { costMin: 12000, costMax: 18000 },
    });

    const res = await request(app).post('/feed/quote-this-look')
      .set('Authorization', `Bearer ${token}`)
      .send({ portfolioProjectId: portfolio.id, imageUrl: portfolio.imageUrls[0] });
    expect(res.status).toBe(201);
    expect(res.body.usedAi).toBe(false);
    expect(res.body.estimationId).toBeNull();
    expect(res.body.estimateLow).toBe(12000);
    expect(res.body.estimateHigh).toBe(18000);

    // Critical: no Claude call, no image download, no Estimation row.
    expect(ai.estimateRenovationCost).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await db.estimation.count()).toBe(0);

    // Message body cites the contractor's listing, not the AI estimator.
    const msgs = await db.message.findMany({
      where: { conversationId: res.body.conversationId },
    });
    expect(msgs[0].body).toContain('Your listing shows');
    expect(msgs[0].body).not.toContain('AI estimator');
    expect(msgs[0].body).toContain('12,000');
    expect(msgs[0].body).toContain('18,000');
  });

  test('falls back to AI when the portfolio range is partial (only costMin)', async () => {
    const { token, portfolio } = await seedFeed();
    await db.portfolioProject.update({
      where: { id: portfolio.id }, data: { costMin: 12000 },
    });

    const res = await request(app).post('/feed/quote-this-look')
      .set('Authorization', `Bearer ${token}`)
      .send({ portfolioProjectId: portfolio.id, imageUrl: portfolio.imageUrls[0] });
    expect(res.status).toBe(201);
    expect(res.body.usedAi).toBe(true);
    expect(ai.estimateRenovationCost).toHaveBeenCalledTimes(1);
  });

  test('reusing the same photo into an existing thread appends a message; does not double-lead', async () => {
    const { token, portfolio } = await seedFeed();

    const first = await request(app).post('/feed/quote-this-look')
      .set('Authorization', `Bearer ${token}`)
      .send({ portfolioProjectId: portfolio.id, imageUrl: portfolio.imageUrls[0] });
    expect(first.status).toBe(201);

    const second = await request(app).post('/feed/quote-this-look')
      .set('Authorization', `Bearer ${token}`)
      .send({ portfolioProjectId: portfolio.id, imageUrl: portfolio.imageUrls[0] });
    expect(second.status).toBe(201);
    expect(second.body.conversationId).toBe(first.body.conversationId);

    const msgs = await db.message.findMany({
      where: { conversationId: first.body.conversationId },
    });
    expect(msgs.length).toBe(2);
    const leads = await db.lead.findMany({
      where: { conversationId: first.body.conversationId },
    });
    expect(leads.length).toBe(1);
  });

  test('400 when the image URL is not from the named portfolio project', async () => {
    const { token, portfolio } = await seedFeed();
    const res = await request(app).post('/feed/quote-this-look')
      .set('Authorization', `Bearer ${token}`)
      .send({ portfolioProjectId: portfolio.id,
              imageUrl: 'https://cdn.example.com/uploads/totally-different.jpg' });
    expect(res.status).toBe(400);
    expect(ai.estimateRenovationCost).not.toHaveBeenCalled();
  });

  test('404 when the portfolio project is not approved', async () => {
    const { token, portfolio } = await seedFeed({ approved: false });
    const res = await request(app).post('/feed/quote-this-look')
      .set('Authorization', `Bearer ${token}`)
      .send({ portfolioProjectId: portfolio.id, imageUrl: portfolio.imageUrls[0] });
    expect(res.status).toBe(404);
  });

  test('403 when contractor has blocked the homeowner', async () => {
    const { client, token, business, portfolio } = await seedFeed();
    const owner = await db.business.findUnique({ where: { id: business.id }, select: { userId: true } });
    await db.block.create({ data: { blockerId: owner.userId, blockedId: client.id } });

    const res = await request(app).post('/feed/quote-this-look')
      .set('Authorization', `Bearer ${token}`)
      .send({ portfolioProjectId: portfolio.id, imageUrl: portfolio.imageUrls[0] });
    expect(res.status).toBe(403);
  });

  test('502 when the inspiration photo can\'t be fetched', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404,
                                          arrayBuffer: async () => new ArrayBuffer(0) });
    const { token, portfolio } = await seedFeed();
    const res = await request(app).post('/feed/quote-this-look')
      .set('Authorization', `Bearer ${token}`)
      .send({ portfolioProjectId: portfolio.id, imageUrl: portfolio.imageUrls[0] });
    expect(res.status).toBe(502);
  });

  test('contractor cannot call the endpoint', async () => {
    const { portfolio } = await seedFeed();
    const { token: bizToken } = await createBusiness();
    const res = await request(app).post('/feed/quote-this-look')
      .set('Authorization', `Bearer ${bizToken}`)
      .send({ portfolioProjectId: portfolio.id, imageUrl: portfolio.imageUrls[0] });
    expect(res.status).toBe(403);
  });
});
