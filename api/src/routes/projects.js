const router = require('express').Router();
const db = require('../services/db');
const { authMiddleware } = require('../middleware/auth');

// A "project" is a derived view, not a table: it's everything tied to one
// homeowner↔contractor pair (quotes, appointments, payments, the conversation),
// grouped by the counterparty. This keeps the hub read-only and migration-free —
// we aggregate over existing rows rather than introducing a Project model.

const QUOTE_OPEN = ['PENDING', 'QUOTED', 'ACCEPTED'];
const APPT_LIVE = ['REQUESTED', 'CONFIRMED'];
const PAYMENT_LIVE = ['PENDING', 'SUCCEEDED'];

// Pick a single human headline for a project card, highest-signal first.
function headlineFor({ quotes, appointments, payments, business }) {
  const now = Date.now();
  const accepted = quotes.find((q) => q.status === 'ACCEPTED');
  const paid = payments.find((p) => p.status === 'SUCCEEDED');
  const upcoming = appointments
    .filter((a) => APPT_LIVE.includes(a.status) && new Date(a.scheduledAt).getTime() >= now)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

  if (accepted && !paid && business.payoutsEnabled) return 'Pay your deposit';
  if (quotes.some((q) => q.status === 'QUOTED')) return 'Quote ready to review';
  if (upcoming.some((a) => a.status === 'CONFIRMED')) return 'Appointment confirmed';
  if (upcoming.some((a) => a.status === 'REQUESTED')) return 'Appointment requested';
  if (quotes.some((q) => q.status === 'PENDING')) return 'Awaiting quote';
  if (paid) return 'Deposit paid';
  return 'In progress';
}

// Whether a project counts as "active" — surfaced in the list. We hide stale
// engagements (declined/withdrawn quotes only, past appointments, refunded
// payments) so the hub shows what needs attention, not full history.
function isActive({ quotes, appointments, payments }) {
  const now = Date.now();
  const liveQuote = quotes.some((q) => QUOTE_OPEN.includes(q.status));
  const upcomingAppt = appointments.some(
    (a) => APPT_LIVE.includes(a.status) && new Date(a.scheduledAt).getTime() >= now,
  );
  const livePayment = payments.some((p) => PAYMENT_LIVE.includes(p.status));
  return liveQuote || upcomingAppt || livePayment;
}

// Latest timestamp across everything in the project — drives card ordering.
function lastActivityAt({ quotes, appointments, payments, conversation }) {
  const stamps = [
    ...quotes.map((q) => q.updatedAt),
    ...appointments.map((a) => a.updatedAt),
    ...payments.map((p) => p.updatedAt),
    conversation?.updatedAt,
  ].filter(Boolean).map((d) => new Date(d).getTime());
  return stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
}

// Unread messages for the requesting party in a conversation.
function unreadCount(conversation, viewerUserId, role) {
  if (!conversation) return 0;
  const watermark = role === 'CLIENT'
    ? conversation.clientLastReadAt
    : conversation.businessLastReadAt;
  return conversation.messages.filter((m) => {
    if (m.senderId === viewerUserId) return false; // own messages aren't unread
    if (!watermark) return true;
    return new Date(m.createdAt) > new Date(watermark);
  }).length;
}

// GET /projects — active projects for the requesting user, grouped by
// counterparty, newest activity first. Works for both homeowner and contractor.
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const isClient = req.user.role !== 'BUSINESS';
    const scope = isClient
      ? { clientId: req.user.id }
      : { business: { userId: req.user.id } };
    const role = isClient ? 'CLIENT' : 'BUSINESS';

    const businessSelect = {
      id: true, companyName: true, logoUrl: true, city: true,
      verified: true, payoutsEnabled: true,
    };

    const [quotes, appointments, payments, conversations] = await Promise.all([
      db.quoteRequest.findMany({ where: scope, include: { business: { select: businessSelect } } }),
      db.appointment.findMany({ where: scope, include: { business: { select: businessSelect } } }),
      db.payment.findMany({ where: scope, include: { business: { select: businessSelect } } }),
      db.conversation.findMany({
        where: scope,
        include: {
          business: { select: businessSelect },
          messages: { select: { senderId: true, createdAt: true } },
        },
      }),
    ]);

    // Group everything by businessId.
    const byBiz = new Map();
    const bucket = (b) => {
      if (!byBiz.has(b.id)) {
        byBiz.set(b.id, { business: b, quotes: [], appointments: [], payments: [], conversation: null });
      }
      return byBiz.get(b.id);
    };
    quotes.forEach((q) => bucket(q.business).quotes.push(q));
    appointments.forEach((a) => bucket(a.business).appointments.push(a));
    payments.forEach((p) => bucket(p.business).payments.push(p));
    conversations.forEach((c) => { bucket(c.business).conversation = c; });

    const projects = [...byBiz.values()]
      .filter(isActive)
      .map((proj) => ({
        businessId: proj.business.id,
        companyName: proj.business.companyName,
        logoUrl: proj.business.logoUrl,
        city: proj.business.city,
        verified: proj.business.verified,
        headline: headlineFor(proj),
        openQuoteCount: proj.quotes.filter((q) => QUOTE_OPEN.includes(q.status)).length,
        upcomingAppointmentCount: proj.appointments.filter(
          (a) => APPT_LIVE.includes(a.status) && new Date(a.scheduledAt).getTime() >= Date.now(),
        ).length,
        unreadCount: unreadCount(proj.conversation, req.user.id, role),
        paymentCount: proj.payments.filter((p) => p.status === 'SUCCEEDED').length,
        lastActivityAt: lastActivityAt(proj),
      }))
      .sort((a, b) => new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0));

    res.json(projects);
  } catch (err) {
    next(err);
  }
});

// GET /projects/:businessId — full aggregated timeline for one engagement.
// (For a homeowner, :businessId is the contractor. For a contractor it would be
// the client, but the param is still the businessId since that anchors the pair.)
router.get('/:businessId', authMiddleware, async (req, res, next) => {
  try {
    const isClient = req.user.role !== 'BUSINESS';
    const role = isClient ? 'CLIENT' : 'BUSINESS';
    const { businessId } = req.params;

    // Scope to the requesting user's side of the pair.
    const scope = isClient
      ? { clientId: req.user.id, businessId }
      : { businessId, business: { userId: req.user.id } };

    const business = await db.business.findUnique({
      where: { id: businessId },
      select: {
        id: true, companyName: true, logoUrl: true, city: true,
        verified: true, payoutsEnabled: true,
      },
    });
    if (!business) return res.status(404).json({ error: 'Not found' });

    const [quotes, appointments, payments, convo] = await Promise.all([
      db.quoteRequest.findMany({
        where: scope,
        orderBy: { createdAt: 'desc' },
        include: { payment: { select: { status: true } } },
      }),
      db.appointment.findMany({ where: scope, orderBy: { scheduledAt: 'desc' } }),
      db.payment.findMany({ where: scope, orderBy: { createdAt: 'desc' } }),
      // findFirst (not findUnique) so the same scoped query resolves the
      // conversation for either side of the pair.
      db.conversation.findFirst({
        where: scope,
        include: { messages: { select: { senderId: true, createdAt: true } } },
      }),
    ]);

    // A project must have at least one artifact for this user, else 404 (don't
    // leak that an unrelated business exists / let users probe arbitrary pairs).
    if (!quotes.length && !appointments.length && !payments.length && !convo) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({
      business,
      conversationId: convo?.id ?? null,
      unreadCount: unreadCount(convo, req.user.id, role),
      quotes: quotes.map((q) => ({
        id: q.id,
        category: q.category,
        description: q.description,
        status: q.status,
        quoteLow: q.quoteLow,
        quoteHigh: q.quoteHigh,
        paymentStatus: q.payment?.status ?? null,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
      })),
      appointments: appointments.map((a) => ({
        id: a.id,
        scheduledAt: a.scheduledAt,
        status: a.status,
        note: a.note,
        createdAt: a.createdAt,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amountCents: p.amountCents,
        status: p.status,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
