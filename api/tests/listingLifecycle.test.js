// Listing-lifecycle warnings. Before these, a business was silently delisted at
// day 30 — no email, no push, no in-app notice — and just stopped getting leads.
//
// Email + push are mocked: we assert on WHO gets notified and that each notice
// fires exactly once per lapse cycle (the sweep runs daily, so a leaky stamp
// would spam contractors every morning).
jest.mock('../src/services/email', () => ({
  isConfigured: () => true,
  sendListingExpiringNotice: jest.fn(async () => ({ ok: true })),
  sendListingLapsedNotice: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../src/services/push', () => ({
  sendPush: jest.fn(async () => ({ sent: 1 })),
  isConfigured: () => true,
}));

const request = require('supertest');
const app = require('../src/app');
const emailService = require('../src/services/email');
const { sendPush } = require('../src/services/push');
const {
  runListingSweep, warnExpiring, noticeLapsed, resetListingNotices,
} = require('../src/services/listingLifecycle');
const { handleStripeEvent } = require('../src/routes/webhooks');
const { db, resetDb, createBusiness } = require('./helpers');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
});
afterAll(async () => { await db.$disconnect(); });

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(Date.now() + n * DAY);

// A business whose free month ends in `days` and has no subscription.
async function expiringBusiness(days, overrides = {}) {
  const { business, user } = await createBusiness({
    freeListingEndsAt: inDays(days), ...overrides,
  });
  return { business, user };
}

describe('Expiring-soon warning', () => {
  test('warns a business whose free month ends inside the window', async () => {
    const { business, user } = await expiringBusiness(3);

    const warned = await warnExpiring();
    expect(warned).toBe(1);

    // Email went to the owner, naming the company and the days remaining.
    expect(emailService.sendListingExpiringNotice).toHaveBeenCalledTimes(1);
    const [to, opts] = emailService.sendListingExpiringNotice.mock.calls[0];
    expect(to).toBe(user.email);
    expect(opts.companyName).toBe(business.companyName);
    expect(opts.daysLeft).toBeGreaterThan(0);

    // Push + activity feed too.
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(await db.activity.count({ where: { userId: user.id, type: 'LISTING' } })).toBe(1);
  });

  test('does not warn a business that is still far from expiry', async () => {
    await expiringBusiness(20);
    expect(await warnExpiring()).toBe(0);
    expect(emailService.sendListingExpiringNotice).not.toHaveBeenCalled();
  });

  test('does not warn a business with a live subscription', async () => {
    const { business } = await expiringBusiness(2);
    await db.business.update({ where: { id: business.id }, data: { proStatus: 'active' } });
    expect(await warnExpiring()).toBe(0);
  });

  test('warns only once even when the sweep runs repeatedly', async () => {
    await expiringBusiness(3);
    expect(await warnExpiring()).toBe(1);
    expect(await warnExpiring()).toBe(0);
    expect(await warnExpiring()).toBe(0);
    expect(emailService.sendListingExpiringNotice).toHaveBeenCalledTimes(1);
  });

  test('an unapproved business is never warned', async () => {
    await expiringBusiness(2, { approvalStatus: 'PENDING' });
    expect(await warnExpiring()).toBe(0);
  });
});

describe('Lapsed notice', () => {
  test('notifies a business whose free month has already ended', async () => {
    const { business, user } = await expiringBusiness(-1);

    expect(await noticeLapsed()).toBe(1);
    expect(emailService.sendListingLapsedNotice).toHaveBeenCalledTimes(1);
    const [to, opts] = emailService.sendListingLapsedNotice.mock.calls[0];
    expect(to).toBe(user.email);
    expect(opts.companyName).toBe(business.companyName);
    expect(await db.activity.count({ where: { userId: user.id, type: 'LISTING' } })).toBe(1);
  });

  test('notifies a business that never had a free month', async () => {
    await createBusiness({ freeListingEndsAt: null });
    expect(await noticeLapsed()).toBe(1);
  });

  test('does not notify a listed business', async () => {
    await expiringBusiness(10);
    expect(await noticeLapsed()).toBe(0);
  });

  test('does not notify a subscriber whose free month lapsed', async () => {
    const { business } = await expiringBusiness(-5);
    await db.business.update({ where: { id: business.id }, data: { proStatus: 'active' } });
    expect(await noticeLapsed()).toBe(0);
  });

  test('notifies only once across repeated sweeps', async () => {
    await expiringBusiness(-1);
    expect(await noticeLapsed()).toBe(1);
    expect(await noticeLapsed()).toBe(0);
    expect(emailService.sendListingLapsedNotice).toHaveBeenCalledTimes(1);
  });
});

describe('Notice stamps reset when a subscription goes live', () => {
  test('subscribing clears both stamps so a future lapse warns again', async () => {
    const { business } = await expiringBusiness(-1);
    await noticeLapsed();
    let row = await db.business.findUnique({ where: { id: business.id } });
    expect(row.listingLapsedNoticeAt).not.toBeNull();

    // Subscription goes live via the Stripe webhook.
    await handleStripeEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_live', customer: 'cus_1', status: 'active',
          trial_end: null, current_period_end: null,
          metadata: { businessId: business.id },
        },
      },
    });

    row = await db.business.findUnique({ where: { id: business.id } });
    expect(row.listingLapsedNoticeAt).toBeNull();
    expect(row.listingExpiryWarnedAt).toBeNull();
  });

  test('resetListingNotices clears both stamps directly', async () => {
    const { business } = await expiringBusiness(-1);
    await noticeLapsed();
    await resetListingNotices(business.id);
    const row = await db.business.findUnique({ where: { id: business.id } });
    expect(row.listingLapsedNoticeAt).toBeNull();
  });
});

describe('Full sweep', () => {
  test('reports both counts and does not double-notify one business', async () => {
    await expiringBusiness(2);   // due a warning
    await expiringBusiness(-3);  // already lapsed
    await expiringBusiness(20);  // neither

    const result = await runListingSweep();
    expect(result).toEqual({ warned: 1, lapsed: 1 });

    // A second pass is a no-op.
    expect(await runListingSweep()).toEqual({ warned: 0, lapsed: 0 });
  });

  test('a delivery failure still stamps, so the sweep never re-notifies in a loop', async () => {
    emailService.sendListingLapsedNotice.mockRejectedValueOnce(new Error('SendGrid 500'));
    const { business } = await expiringBusiness(-1);

    await expect(noticeLapsed()).resolves.toBe(1);
    const row = await db.business.findUnique({ where: { id: business.id } });
    expect(row.listingLapsedNoticeAt).not.toBeNull();
    // And it does not try again on the next run.
    expect(await noticeLapsed()).toBe(0);
  });
});

describe('POST /internal/listing-sweep', () => {
  const KEY = 'test-internal-key-000';
  const saved = process.env.INTERNAL_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = saved;
  });

  test('404s entirely when no internal key is configured', async () => {
    delete process.env.INTERNAL_API_KEY;
    const res = await request(app).post('/internal/listing-sweep');
    expect(res.status).toBe(404);
  });

  test('401s without the correct key', async () => {
    process.env.INTERNAL_API_KEY = KEY;
    expect((await request(app).post('/internal/listing-sweep')).status).toBe(401);
    const wrong = await request(app).post('/internal/listing-sweep')
      .set('x-internal-key', 'wrong-key-000000000');
    expect(wrong.status).toBe(401);
  });

  test('runs the sweep with the correct key', async () => {
    process.env.INTERNAL_API_KEY = KEY;
    await expiringBusiness(-1);
    const res = await request(app).post('/internal/listing-sweep')
      .set('x-internal-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, warned: 0, lapsed: 1 });
  });
});
