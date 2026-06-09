const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { uploadImage } = require('../services/storage');
const { sendPush } = require('../services/push');
const { recordActivity } = require('../services/activity');
const {
  commissionCentsFor,
  createMilestoneCheckoutSession,
  createMilestoneTransfer,
  createMilestoneRefund,
} = require('../services/stripe');

// Notify a recipient about a milestone/escrow event (rides the PAYMENT category).
function notifyPayment(recipientId, { title, body, data }) {
  if (!recipientId) return;
  sendPush(recipientId, { type: 'PAYMENT', title, body, data: data || {} }).catch(console.error);
  return recordActivity(recipientId, { type: 'PAYMENT', title, body, data: data || {} });
}

// Stable title for the post-release review nudge — also used to dedupe so a
// multi-milestone project doesn't ask the same homeowner over and over.
const REVIEW_PROMPT_TITLE = 'How did it go? ⭐';

// Once a milestone's funds are released, nudge the homeowner to review the
// contractor. Scoped per (business, homeowner) to mirror the one-review-per-
// business rule: skip if they've already reviewed, and don't stack duplicate
// prompts as further milestones release. Rides the REVIEW notification category.
async function promptReviewAfterRelease(project) {
  const clientId = project.clientId;
  if (!clientId || !project.businessId) return;

  // Already left a review for this contractor — nothing to ask for.
  const existingReview = await db.review.findUnique({
    where: { businessId_authorId: { businessId: project.businessId, authorId: clientId } },
  });
  if (existingReview) return;

  // Already nudged for this contractor — don't pile up duplicate prompts.
  const alreadyPrompted = await db.activity.findFirst({
    where: {
      userId: clientId,
      type: 'REVIEW',
      title: REVIEW_PROMPT_TITLE,
      data: { path: ['businessId'], equals: project.businessId },
    },
  });
  if (alreadyPrompted) return;

  const company = project.business?.companyName || 'your contractor';
  const body = `Your milestone payment to ${company} was released. How did the work go? Leave a review to help other homeowners.`;
  const data = { businessId: project.businessId, projectId: project.id, prompt: 'review' };
  sendPush(clientId, { type: 'REVIEW', title: REVIEW_PROMPT_TITLE, body, data }).catch(console.error);
  await recordActivity(clientId, { type: 'REVIEW', title: REVIEW_PROMPT_TITLE, body, data });
}

// A "project" is a derived view, not a table: it's everything tied to one
// homeowner↔contractor pair (quotes, appointments, payments, the conversation),
// grouped by the counterparty. This keeps the hub read-only and migration-free —
// we aggregate over existing rows rather than introducing a Project model.

const QUOTE_OPEN = ['PENDING', 'QUOTED', 'ACCEPTED'];
const APPT_LIVE = ['REQUESTED', 'CONFIRMED'];
const PAYMENT_LIVE = ['PENDING', 'SUCCEEDED'];
// Milestones whose money is currently held on the platform (in escrow).
const MILESTONE_HELD = ['FUNDED', 'SUBMITTED'];
// Milestones still in flight — keep the project surfaced while any remain.
const MILESTONE_LIVE = ['PENDING', 'FUNDED', 'SUBMITTED'];

// Pick a single human headline for a project card, highest-signal first.
// Milestone escrow that needs the viewer's attention outranks everything else,
// since it's money in motion (homeowner: approve work; contractor: do the work).
function headlineFor({ quotes, appointments, payments, milestones, business }, role) {
  const now = Date.now();
  const accepted = quotes.find((q) => q.status === 'ACCEPTED');
  const paid = payments.find((p) => p.status === 'SUCCEEDED');
  const upcoming = appointments
    .filter((a) => APPT_LIVE.includes(a.status) && new Date(a.scheduledAt).getTime() >= now)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

  const ms = milestones || [];
  if (role === 'CLIENT' && ms.some((m) => m.status === 'SUBMITTED')) return 'Approve completed work';
  if (role === 'BUSINESS' && ms.some((m) => m.status === 'FUNDED')) return 'Submit completed work';
  if (role === 'CLIENT' && ms.some((m) => m.status === 'PENDING')) return 'Fund a milestone';

  if (accepted && !paid && business.payoutsEnabled) return 'Pay your deposit';
  if (quotes.some((q) => q.status === 'QUOTED')) return 'Quote ready to review';
  if (upcoming.some((a) => a.status === 'CONFIRMED')) return 'Appointment confirmed';
  if (upcoming.some((a) => a.status === 'REQUESTED')) return 'Appointment requested';
  if (quotes.some((q) => q.status === 'PENDING')) return 'Awaiting quote';
  if (ms.some((m) => MILESTONE_HELD.includes(m.status))) return 'Funds in escrow';
  if (paid) return 'Deposit paid';
  return 'In progress';
}

// Role-aware milestone progress for a project card: how many stages exist, how
// many are released, how much is currently held in escrow, and how many need
// the viewer to act (homeowner approves SUBMITTED work; contractor submits
// FUNDED work).
function milestoneProgress(milestones, role) {
  const list = milestones || [];
  const escrowCents = list
    .filter((m) => MILESTONE_HELD.includes(m.status))
    .reduce((sum, m) => sum + m.amountCents, 0);
  const milestoneActionCount = role === 'CLIENT'
    ? list.filter((m) => m.status === 'SUBMITTED').length
    : list.filter((m) => m.status === 'FUNDED').length;
  return {
    milestoneTotal: list.length,
    milestonesReleased: list.filter((m) => m.status === 'APPROVED').length,
    escrowCents,
    milestoneActionCount,
  };
}

// Whether a project counts as "active" — surfaced in the list. We hide stale
// engagements (declined/withdrawn quotes only, past appointments, refunded
// payments) so the hub shows what needs attention, not full history.
function isActive({ quotes, appointments, payments, milestones }) {
  const now = Date.now();
  const liveQuote = quotes.some((q) => QUOTE_OPEN.includes(q.status));
  const upcomingAppt = appointments.some(
    (a) => APPT_LIVE.includes(a.status) && new Date(a.scheduledAt).getTime() >= now,
  );
  const livePayment = payments.some((p) => PAYMENT_LIVE.includes(p.status));
  // Escrow keeps a project active even after its quote/appointment go stale —
  // money is still in motion until every milestone is released or refunded.
  const liveMilestone = (milestones || []).some((m) => MILESTONE_LIVE.includes(m.status));
  return liveQuote || upcomingAppt || livePayment || liveMilestone;
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

    const [quotes, appointments, payments, conversations, persistedProjects] = await Promise.all([
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
      db.project.findMany({
        where: scope,
        include: {
          business: { select: businessSelect },
          milestones: { select: { amountCents: true, status: true } },
        },
      }),
    ]);

    // Group everything by businessId.
    const byBiz = new Map();
    const bucket = (b) => {
      if (!byBiz.has(b.id)) {
        byBiz.set(b.id, { business: b, quotes: [], appointments: [], payments: [], conversation: null, milestones: [] });
      }
      return byBiz.get(b.id);
    };
    quotes.forEach((q) => bucket(q.business).quotes.push(q));
    appointments.forEach((a) => bucket(a.business).appointments.push(a));
    payments.forEach((p) => bucket(p.business).payments.push(p));
    conversations.forEach((c) => { bucket(c.business).conversation = c; });
    persistedProjects.forEach((pr) => { bucket(pr.business).milestones = pr.milestones; });

    const projects = [...byBiz.values()]
      .filter(isActive)
      .map((proj) => ({
        businessId: proj.business.id,
        companyName: proj.business.companyName,
        logoUrl: proj.business.logoUrl,
        city: proj.business.city,
        verified: proj.business.verified,
        headline: headlineFor(proj, role),
        openQuoteCount: proj.quotes.filter((q) => QUOTE_OPEN.includes(q.status)).length,
        upcomingAppointmentCount: proj.appointments.filter(
          (a) => APPT_LIVE.includes(a.status) && new Date(a.scheduledAt).getTime() >= Date.now(),
        ).length,
        unreadCount: unreadCount(proj.conversation, req.user.id, role),
        paymentCount: proj.payments.filter((p) => p.status === 'SUCCEEDED').length,
        ...milestoneProgress(proj.milestones, role),
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

    // The persisted Project (with milestones), if escrow has been set up for
    // this pair. Absent for engagements that only have derived artifacts.
    const persisted = await db.project.findFirst({
      where: scope,
      include: { milestones: { orderBy: { createdAt: 'asc' } } },
    });

    // A project must have at least one artifact for this user, else 404 (don't
    // leak that an unrelated business exists / let users probe arbitrary pairs).
    if (!quotes.length && !appointments.length && !payments.length && !convo && !persisted) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({
      business,
      conversationId: convo?.id ?? null,
      unreadCount: unreadCount(convo, req.user.id, role),
      project: persisted ? serializeProject(persisted, { includeClientNotes: isClient }) : null,
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
        commissionCents: p.commissionCents,
        // Distinguishes a quote-deposit from a milestone-funded payment so the
        // receipt sheet can label and link to the right artifact.
        kind: p.milestoneId ? 'MILESTONE' : 'DEPOSIT',
        description: p.description,
        status: p.status,
        paidAt: p.paidAt,
        refundedAt: p.refundedAt,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Shape a persisted Project + milestones for the API. `includeClientNotes`
// gates the homeowner-only scratchpad — contractors never see it.
function serializeProject(project, { includeClientNotes = false } = {}) {
  return {
    id: project.id,
    title: project.title,
    status: project.status,
    quoteRequestId: project.quoteRequestId,
    ...(includeClientNotes ? { clientNotes: project.clientNotes ?? null } : {}),
    createdAt: project.createdAt,
    milestones: (project.milestones || []).map((m) => ({
      id: m.id,
      title: m.title,
      amountCents: m.amountCents,
      status: m.status,
      proofUrls: m.proofUrls,
      fundedAt: m.fundedAt,
      submittedAt: m.submittedAt,
      approvedAt: m.approvedAt,
      createdAt: m.createdAt,
    })),
  };
}

// PATCH /projects/:projectId/notes — homeowner-only scratchpad. Free-form
// text capped at 8000 chars (enough for a wall of contractor notes without
// turning the column into an attack surface). Empty string clears.
router.patch('/:projectId/notes', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { notes } = z.object({
      notes: z.string().max(8000),
    }).strict().parse(req.body);

    const project = await db.project.findUnique({ where: { id: req.params.projectId } });
    if (!project) return res.status(404).json({ error: 'Not found' });
    if (project.clientId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updated = await db.project.update({
      where: { id: project.id },
      data: { clientNotes: notes.length ? notes : null },
    });
    res.json({ clientNotes: updated.clientNotes });
  } catch (err) {
    next(err);
  }
});

// How long after a contractor submits work before funds auto-release if the
// homeowner doesn't respond. Protects contractors from being ghosted.
const AUTO_RELEASE_DAYS = () => parseInt(process.env.MILESTONE_AUTO_RELEASE_DAYS || '7', 10);

// POST /projects — create (or fetch) the persistent Project for an accepted
// quote. Either party to the quote can set it up; idempotent on the (client,
// business) pair so a second call returns the existing project.
router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const { quoteRequestId } = z.object({ quoteRequestId: z.string().min(1).max(64) }).strict().parse(req.body);

    const quote = await db.quoteRequest.findUnique({
      where: { id: quoteRequestId },
      include: { business: { select: { id: true, userId: true, companyName: true } } },
    });
    if (!quote) return res.status(404).json({ error: 'Not found' });

    const isClient = quote.clientId === req.user.id;
    const isOwner = quote.business.userId === req.user.id;
    if (!isClient && !isOwner && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (quote.status !== 'ACCEPTED') {
      return res.status(409).json({ error: 'A project can only be started from an accepted quote.' });
    }

    // Idempotent on the pair: reuse an existing project if one's already set up.
    const existing = await db.project.findUnique({
      where: { clientId_businessId: { clientId: quote.clientId, businessId: quote.business.id } },
      include: { milestones: { orderBy: { createdAt: 'asc' } } },
    });
    if (existing) return res.status(200).json(serializeProject(existing, { includeClientNotes: isClient }));

    const project = await db.project.create({
      data: {
        clientId: quote.clientId,
        businessId: quote.business.id,
        quoteRequestId: quote.id,
        title: quote.category ? `${quote.category} project` : 'Renovation project',
      },
      include: { milestones: true },
    });
    res.status(201).json(serializeProject(project, { includeClientNotes: isClient }));
  } catch (err) {
    next(err);
  }
});

// Load a project and assert the requester is a participant. Returns null (after
// sending the response) when missing/forbidden.
async function loadProjectParticipant(req, res) {
  const project = await db.project.findUnique({
    where: { id: req.params.projectId },
    include: {
      business: { select: { id: true, userId: true, companyName: true, stripeAccountId: true, payoutsEnabled: true } },
      milestones: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!project) { res.status(404).json({ error: 'Not found' }); return null; }
  const isClient = project.clientId === req.user.id;
  const isOwner = project.business.userId === req.user.id;
  if (!isClient && !isOwner && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' }); return null;
  }
  return { project, isClient, isOwner };
}

// POST /projects/:projectId/milestones — the contractor defines a payment stage.
router.post('/:projectId/milestones', authMiddleware, requireRole('BUSINESS', 'ADMIN'), async (req, res, next) => {
  try {
    const data = z.object({
      title: z.string().min(1).max(200),
      amountCents: z.number().int().min(100).max(100000000), // $1 … $1M
    }).strict().parse(req.body);

    const loaded = await loadProjectParticipant(req, res);
    if (!loaded) return;
    if (!loaded.isOwner && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only the contractor can add milestones.' });
    }
    if (loaded.project.status !== 'ACTIVE') {
      return res.status(409).json({ error: 'This project is closed.' });
    }

    const milestone = await db.milestone.create({
      data: { projectId: loaded.project.id, title: data.title, amountCents: data.amountCents },
    });

    await notifyPayment(loaded.project.clientId, {
      title: 'New payment milestone 🧱',
      body: `${loaded.project.business.companyName} added "${data.title}" — $${(data.amountCents / 100).toLocaleString()}.`,
      data: { projectId: loaded.project.id, businessId: loaded.project.businessId },
    });

    res.status(201).json(milestone);
  } catch (err) {
    next(err);
  }
});

// Load a milestone within a project and assert participation.
async function loadMilestone(req, res) {
  const loaded = await loadProjectParticipant(req, res);
  if (!loaded) return null;
  const milestone = loaded.project.milestones.find((m) => m.id === req.params.milestoneId);
  if (!milestone) { res.status(404).json({ error: 'Not found' }); return null; }
  return { ...loaded, milestone };
}

// POST /projects/:projectId/milestones/:milestoneId/fund — the homeowner funds a
// milestone via hosted Checkout. Money is held on the platform until release.
router.post('/:projectId/milestones/:milestoneId/fund', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const loaded = await loadMilestone(req, res);
    if (!loaded) return;
    const { project, isClient, milestone } = loaded;
    if (!isClient) return res.status(403).json({ error: 'Only the homeowner can fund a milestone.' });

    if (!['PENDING'].includes(milestone.status)) {
      return res.status(409).json({ error: 'This milestone has already been funded.' });
    }
    if (!project.business.stripeAccountId || !project.business.payoutsEnabled) {
      return res.status(409).json({ error: 'This contractor can\'t accept in-app payments yet.' });
    }

    const commissionCents = commissionCentsFor(milestone.amountCents);
    const totalCents = milestone.amountCents + commissionCents; // fee on top
    const description = `${milestone.title} — ${project.business.companyName}`;

    // Create/refresh a PENDING Payment row whose id rides along as metadata so
    // the webhook can settle this exact funding and flip the milestone to FUNDED.
    const existing = await db.payment.findUnique({ where: { milestoneId: milestone.id } });
    const data = {
      clientId: req.user.id,
      businessId: project.businessId,
      milestoneId: milestone.id,
      amountCents: totalCents,
      commissionCents,
      status: 'PENDING',
      description,
    };
    const payment = existing
      ? await db.payment.update({ where: { id: existing.id }, data })
      : await db.payment.create({ data });

    const client = await db.user.findUnique({ where: { id: req.user.id }, select: { email: true } });
    const session = await createMilestoneCheckoutSession({
      totalCents,
      customerEmail: client?.email,
      description,
      metadata: {
        paymentId: payment.id,
        milestoneId: milestone.id,
        projectId: project.id,
        businessId: project.businessId,
        clientId: req.user.id,
      },
    });

    res.status(201).json({
      paymentId: payment.id,
      url: session.url,
      totalCents,
      amountCents: milestone.amountCents,
      commissionCents,
    });
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/milestones/:milestoneId/submit — the contractor
// marks the stage complete and attaches proof photos.
router.post(
  '/:projectId/milestones/:milestoneId/submit',
  authMiddleware,
  requireRole('BUSINESS', 'ADMIN'),
  upload.array('images', 8),
  async (req, res, next) => {
    try {
      const loaded = await loadMilestone(req, res);
      if (!loaded) return;
      const { project, isOwner, milestone } = loaded;
      if (!isOwner && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only the contractor can submit work.' });
      }
      if (milestone.status !== 'FUNDED') {
        return res.status(409).json({ error: 'Only a funded milestone can be submitted.' });
      }

      const base = `${req.protocol}://${req.get('host')}`;
      const urls = req.files?.length
        ? await Promise.all(req.files.map((f) => uploadImage(f.buffer, f.mimetype, base)))
        : [];

      const updated = await db.milestone.update({
        where: { id: milestone.id },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          proofUrls: [...milestone.proofUrls, ...urls],
        },
      });

      await notifyPayment(project.clientId, {
        title: 'Work submitted for review 📸',
        body: `${project.business.companyName} finished "${milestone.title}". Review and release the payment.`,
        data: { projectId: project.id, businessId: project.businessId },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// Release a funded milestone to the contractor (shared by manual approval and
// the auto-release job). Transfers the contractor's portion; commission stays.
async function releaseMilestone(project, milestone) {
  const transfer = await createMilestoneTransfer({
    amountCents: milestone.amountCents,
    connectedAccountId: project.business.stripeAccountId,
    metadata: { milestoneId: milestone.id, projectId: project.id },
  });
  const updated = await db.milestone.update({
    where: { id: milestone.id },
    data: { status: 'APPROVED', approvedAt: new Date(), stripeTransferId: transfer.id },
  });
  await notifyPayment(project.business.userId, {
    title: 'Milestone released 💰',
    body: `Payment for "${milestone.title}" ($${(milestone.amountCents / 100).toLocaleString()}) is on its way.`,
    data: { projectId: project.id, businessId: project.businessId },
  });
  // Work shipped and paid — a natural moment to ask the homeowner for a review.
  await promptReviewAfterRelease(project);
  return updated;
}

// POST /projects/:projectId/milestones/:milestoneId/approve — the homeowner
// releases the held funds. Allowed once the milestone is funded (and typically
// after the contractor submits proof).
router.post('/:projectId/milestones/:milestoneId/approve', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const loaded = await loadMilestone(req, res);
    if (!loaded) return;
    const { project, isClient, milestone } = loaded;
    if (!isClient) return res.status(403).json({ error: 'Only the homeowner can release a milestone.' });
    if (milestone.status === 'DISPUTED') {
      return res.status(409).json({ error: 'This milestone is under dispute. Withdraw the dispute first.' });
    }
    if (!['FUNDED', 'SUBMITTED'].includes(milestone.status)) {
      return res.status(409).json({ error: 'This milestone isn\'t awaiting release.' });
    }
    if (!project.business.stripeAccountId) {
      return res.status(409).json({ error: 'The contractor has no payout account.' });
    }

    const updated = await releaseMilestone(project, milestone);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/milestones/:milestoneId/refund — return held funds to
// the homeowner before release. Contractor or admin only (mirrors deposit refund
// authorization). Flips to REFUNDED on the charge.refunded webhook.
router.post('/:projectId/milestones/:milestoneId/refund', authMiddleware, async (req, res, next) => {
  try {
    const loaded = await loadMilestone(req, res);
    if (!loaded) return;
    const { isOwner, milestone } = loaded;
    if (!isOwner && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only the contractor or an admin can refund.' });
    }
    if (milestone.status === 'DISPUTED' && req.user.role !== 'ADMIN') {
      return res.status(409).json({ error: 'A disputed milestone can only be refunded by an admin via the dispute queue.' });
    }
    if (!['FUNDED', 'SUBMITTED', 'DISPUTED'].includes(milestone.status)) {
      return res.status(409).json({ error: 'Only a funded milestone can be refunded.' });
    }

    const payment = await db.payment.findUnique({ where: { milestoneId: milestone.id } });
    if (!payment?.stripePaymentIntentId) {
      return res.status(409).json({ error: 'This milestone has no charge to refund.' });
    }

    await createMilestoneRefund(payment.stripePaymentIntentId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── DISPUTES ─────────────────────────────────────────────────────────────────
//
// A homeowner can dispute a FUNDED or SUBMITTED milestone before the auto-
// release fires. Opening flips status to DISPUTED, which the sweep and the
// homeowner-approve route both refuse to touch. Withdrawal restores the
// prior status; admin resolution flips to APPROVED (release) or REFUNDED.

const DISPUTE_REASONS = [
  'WORK_NOT_DONE', 'WORK_INCOMPLETE', 'WORK_LOW_QUALITY', 'NOT_AS_AGREED',
  'DAMAGE', 'WRONG_AMOUNT', 'OTHER',
];

// POST /projects/:projectId/milestones/:milestoneId/dispute — homeowner opens
// a dispute. Pauses auto-release until withdrawn or admin-resolved.
router.post('/:projectId/milestones/:milestoneId/dispute', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { reason, details } = z.object({
      reason: z.enum(DISPUTE_REASONS),
      details: z.string().trim().min(10).max(2000),
    }).strict().parse(req.body);

    const loaded = await loadMilestone(req, res);
    if (!loaded) return;
    const { project, isClient, milestone } = loaded;
    if (!isClient) return res.status(403).json({ error: 'Only the homeowner can dispute a milestone.' });
    if (!['FUNDED', 'SUBMITTED'].includes(milestone.status)) {
      return res.status(409).json({ error: 'Only a funded milestone can be disputed.' });
    }

    // One open dispute per milestone at a time.
    const existing = await db.dispute.findFirst({
      where: { milestoneId: milestone.id, status: 'OPEN' },
    });
    if (existing) return res.status(409).json({ error: 'This milestone is already under dispute.' });

    const [dispute] = await db.$transaction([
      db.dispute.create({
        data: {
          milestoneId: milestone.id,
          raisedById: req.user.id,
          reason,
          details,
        },
      }),
      db.milestone.update({
        where: { id: milestone.id },
        data: { status: 'DISPUTED', preDisputeStatus: milestone.status },
      }),
    ]);

    // Notify the contractor and the admin team.
    await notifyPayment(project.business.userId, {
      title: 'Milestone disputed ⚠️',
      body: `The homeowner has opened a dispute on "${milestone.title}". Funds are paused until it's resolved.`,
      data: { projectId: project.id, milestoneId: milestone.id, disputeId: dispute.id },
    });

    res.status(201).json(dispute);
  } catch (err) {
    next(err);
  }
});

// POST /projects/:projectId/milestones/:milestoneId/dispute/withdraw — homeowner
// withdraws their own open dispute. Restores the milestone's pre-dispute status.
router.post('/:projectId/milestones/:milestoneId/dispute/withdraw', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const loaded = await loadMilestone(req, res);
    if (!loaded) return;
    const { project, isClient, milestone } = loaded;
    if (!isClient) return res.status(403).json({ error: 'Only the homeowner can withdraw their dispute.' });
    if (milestone.status !== 'DISPUTED') {
      return res.status(409).json({ error: 'No open dispute on this milestone.' });
    }

    const open = await db.dispute.findFirst({
      where: { milestoneId: milestone.id, status: 'OPEN', raisedById: req.user.id },
    });
    if (!open) return res.status(404).json({ error: 'No open dispute to withdraw.' });

    const restoredStatus = milestone.preDisputeStatus || 'FUNDED';
    await db.$transaction([
      db.dispute.update({
        where: { id: open.id },
        data: { status: 'WITHDRAWN', resolvedAt: new Date() },
      }),
      db.milestone.update({
        where: { id: milestone.id },
        data: { status: restoredStatus, preDisputeStatus: null },
      }),
    ]);

    await notifyPayment(project.business.userId, {
      title: 'Dispute withdrawn ✅',
      body: `The homeowner withdrew the dispute on "${milestone.title}".`,
      data: { projectId: project.id, milestoneId: milestone.id },
    });

    res.json({ ok: true, milestoneStatus: restoredStatus });
  } catch (err) {
    next(err);
  }
});

// Release any milestones that have been SUBMITTED longer than the grace window
// and never actioned by the homeowner. Called by a scheduled job. Exported for
// direct testing. Returns the number released.
async function autoReleaseStaleMilestones({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - AUTO_RELEASE_DAYS() * 24 * 60 * 60 * 1000);
  const stale = await db.milestone.findMany({
    where: { status: 'SUBMITTED', submittedAt: { lte: cutoff } },
    include: {
      project: {
        include: { business: { select: { id: true, userId: true, companyName: true, stripeAccountId: true } } },
      },
    },
  });
  let released = 0;
  for (const m of stale) {
    if (!m.project.business.stripeAccountId) continue; // can't pay out yet; skip
    try {
      // releaseMilestone notifies the contractor; the homeowner also needs to
      // know their funds went out automatically (they never tapped approve).
      await releaseMilestone(m.project, m);
      released += 1;
      await notifyPayment(m.project.clientId, {
        title: 'Milestone auto-released ⏱️',
        body: `"${m.title}" was approved automatically after ${AUTO_RELEASE_DAYS()} days, and the payment was sent to ${m.project.business.companyName}.`,
        data: { projectId: m.project.id, businessId: m.project.businessId },
      });
    } catch (err) {
      console.error('Auto-release failed for milestone', m.id, err);
    }
  }
  return released;
}

module.exports = router;
module.exports.autoReleaseStaleMilestones = autoReleaseStaleMilestones;
// Shared by admin.js for resolving disputes with a RELEASE action.
module.exports.releaseMilestone = releaseMilestone;
module.exports.notifyPayment = notifyPayment;
