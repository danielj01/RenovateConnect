const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { sendPush } = require('../services/push');
const { recordActivity } = require('../services/activity');
const { areBlocked } = require('../services/moderation');
const { estimateRenovationCost } = require('../services/ai');
const { isListed, listedWhere } = require('../services/listing');

// GET /feed — the public "Inspiration" feed: a flattened stream of approved
// portfolio photos (each image is its own item), paired with its "before" photo
// when the contractor uploaded one, plus the business + cost range so a tap can
// route to the company. Page/limit pagination over a capped candidate set —
// fine at launch scale; revisit with seek pagination + a Pin table if volume
// grows (see docs/RESEARCH_discovery_feed.md).
router.get('/', async (req, res, next) => {
  try {
    const { category, page = '1', limit = '30' } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const take = Math.min(60, Math.max(1, parseInt(limit, 10) || 30));
    const skip = (pageNum - 1) * take;

    // Both the project AND its business must be publicly visible — a delisted
    // contractor's photos leave the feed with them.
    const where = {
      approvalStatus: 'APPROVED',
      business: { approvalStatus: 'APPROVED', ...listedWhere() },
    };
    if (category) where.category = category;

    const projects = await db.portfolioProject.findMany({
      where,
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      take: 400, // candidate cap; flattened + paginated below
      include: {
        business: {
          select: {
            id: true, companyName: true, logoUrl: true, city: true, state: true, verified: true,
          },
        },
      },
    });

    // Flatten each project's images into individual feed items, pairing the
    // i-th "after" image with the i-th "before" image when present.
    const items = [];
    for (const p of projects) {
      if (!p.business) continue; // safety
      p.imageUrls.forEach((imageUrl, i) => {
        const beforeImageUrl = p.beforeImageUrls?.[i] || null;
        items.push({
          id: `${p.id}:${i}`,
          imageUrl,
          beforeImageUrl,
          isBeforeAfter: Boolean(beforeImageUrl),
          category: p.category || null,
          costMin: p.costMin,
          costMax: p.costMax,
          projectId: p.id,
          title: p.title,
          business: p.business,
        });
      });
    }

    const pageItems = items.slice(skip, skip + take);
    res.json({
      items: pageItems,
      page: pageNum,
      limit: take,
      hasMore: skip + take < items.length,
    });
  } catch (err) {
    next(err);
  }
});

// POST /feed/quote-this-look — the flagship "one-tap intro" from an
// inspiration photo to a real lead. Server-side this:
//   1. Loads the portfolio project (and verifies the imageUrl belongs to it).
//   2. Downloads the photo and runs the Claude vision estimator against it,
//      seeded with the project's category as the room type.
//   3. Creates an Estimation row owned by the homeowner.
//   4. Upserts the conversation with the contractor.
//   5. Posts the inspiration photo as the first message, body pre-filled with
//      a short "I'd love a quote for something like this — AI estimate is ~$X"
//      message that gives the contractor immediate context.
//   6. Records a Lead + push + activity entry on first contact, same as the
//      organic POST /conversations path.
//
// Returns { conversationId, estimationId, estimateLow, estimateHigh, usedAi }.
// `estimationId` is null when the contractor's posted cost range was used
// (no Estimation row written). `usedAi` reflects which source provided the
// range so the client can render the right "source" copy.
router.post('/quote-this-look', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { portfolioProjectId, imageUrl } = z.object({
      portfolioProjectId: z.string().min(1).max(64),
      imageUrl:           z.string().url().max(2048),
    }).strict().parse(req.body);

    const portfolio = await db.portfolioProject.findUnique({
      where: { id: portfolioProjectId },
      include: {
        business: {
          select: {
            id: true, userId: true, companyName: true,
            approvalStatus: true, proStatus: true, freeListingEndsAt: true,
          },
        },
      },
    });
    if (!portfolio || portfolio.approvalStatus !== 'APPROVED' || !portfolio.business
        || !isListed(portfolio.business)) {
      return res.status(404).json({ error: 'Not found' });
    }
    // The image must come from this portfolio's own gallery (after or before).
    const allImages = [...portfolio.imageUrls, ...(portfolio.beforeImageUrls || [])];
    if (!allImages.includes(imageUrl)) {
      return res.status(400).json({ error: 'Image is not part of this portfolio project' });
    }

    // Block enforcement (mirrors POST /conversations).
    if (await areBlocked(req.user.id, portfolio.business.userId)) {
      return res.status(403).json({ error: 'Cannot message this user' });
    }

    // Prefer the contractor's own posted range — it's authoritative for their
    // work and saves a Claude call. Only when the portfolio item is missing a
    // complete range do we fall back to the AI vision estimator.
    let low  = Number.isFinite(portfolio.costMin) ? Math.round(portfolio.costMin) : null;
    let high = Number.isFinite(portfolio.costMax) ? Math.round(portfolio.costMax) : null;
    let usedAi = false;
    let estimation = null;

    if (low == null || high == null) {
      // Download the image bytes and run the estimator. Claude vision accepts
      // base64; we fetch our own S3/local URL straight as bytes.
      let imageBase64;
      try {
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        imageBase64 = buf.toString('base64');
      } catch {
        return res.status(502).json({ error: 'Could not load the inspiration photo' });
      }

      const result = await estimateRenovationCost({
        imageBase64Array: [imageBase64],
        roomType: portfolio.category || null,
        description: `Inspired by "${portfolio.title}" by ${portfolio.business.companyName}`,
      });
      usedAi = true;
      low  = Number.isFinite(result?.totalLow)  ? Math.round(result.totalLow)  : null;
      high = Number.isFinite(result?.totalHigh) ? Math.round(result.totalHigh) : null;
      estimation = await db.estimation.create({
        data: {
          userId:      req.user.id,
          imageUrls:   [imageUrl],
          roomType:    portfolio.category || null,
          description: `Quote-this-look from "${portfolio.title}"`,
          result,
        },
      });
    }

    // Reuse an open thread if one exists; otherwise open a fresh one.
    const isFirstContact = !(await db.conversation.findUnique({
      where: { clientId_businessId: { clientId: req.user.id, businessId: portfolio.business.id } },
    }));
    const conversation = await db.conversation.upsert({
      where:  { clientId_businessId: { clientId: req.user.id, businessId: portfolio.business.id } },
      create: { clientId: req.user.id, businessId: portfolio.business.id },
      update: {},
    });

    // Prefill body — phrase the source honestly. Contractor-posted range
    // reads as their own; AI-derived range names the estimator so the
    // contractor knows it isn't being represented as theirs.
    let range = '';
    if (low != null && high != null) {
      range = usedAi
        ? `Our AI estimator put a project like this at about $${low.toLocaleString()}–$${high.toLocaleString()}.`
        : `Your listing shows projects like this run about $${low.toLocaleString()}–$${high.toLocaleString()}.`;
    }
    const body = `Hi ${portfolio.business.companyName}! I love this look from "${portfolio.title}" and would love a quote on something similar.${range ? ' ' + range : ''} Are you available?`;

    await db.message.create({
      data: {
        conversationId: conversation.id,
        senderId: req.user.id,
        body,
        imageUrls: [imageUrl],
      },
    });
    await db.conversation.update({
      where: { id: conversation.id },
      data:  { updatedAt: new Date(), clientLastReadAt: new Date() },
    });

    if (isFirstContact && portfolio.business.userId) {
      await db.lead.create({
        data: { conversationId: conversation.id, businessId: portfolio.business.id },
      });
      const client = await db.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
      const pushBody = `${client?.name || 'A homeowner'} wants a quote inspired by "${portfolio.title}".`;
      sendPush(portfolio.business.userId, {
        type:  'LEAD',
        title: 'New lead from your portfolio 🎉',
        body:  pushBody,
        data:  { type: 'lead', conversationId: conversation.id },
      }).catch(console.error);
      await recordActivity(portfolio.business.userId, {
        type:  'LEAD',
        title: 'New lead from your portfolio',
        body:  pushBody,
        data:  { conversationId: conversation.id },
      });
    }

    res.status(201).json({
      conversationId: conversation.id,
      estimationId:   estimation ? estimation.id : null,
      estimateLow:    low,
      estimateHigh:   high,
      usedAi,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
