const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { sendPush } = require('../services/push');
const { recordActivity } = require('../services/activity');
const { areBlocked } = require('../services/moderation');
const { estimateRenovationCost } = require('../services/ai');
const { isListed, listedWhere } = require('../services/listing');

// The public "Inspiration" feed.
//
// The feed is POST-CENTRIC: each item is one publishable thing with an ordered
// list of `slides` you swipe through (Pinterest pin / TikTok photo carousel),
// NOT one item per photo as it was originally. Flattening every image into its
// own tile meant a five-photo kitchen remodel occupied five unconnected
// squares and the viewer never saw them as one project.
//
// Two sources are merged into that one shape:
//   • `InspirationPost` — a contractor posting straight to the feed (kind POST)
//   • `PortfolioProject` — the approved portfolio photos we've always shown,
//     with the project's images as its slides (kind PROJECT)
//
// Every item also carries flat `imageUrl` / `beforeImageUrl` / `isBeforeAfter`
// cover fields mirroring `slides[0]`, so anything reading the pre-slideshow
// shape still renders the cover photo.

const BUSINESS_SELECT = {
  id: true, companyName: true, logoUrl: true, city: true, state: true, verified: true,
};

// Pair the i-th "after" image with the i-th "before" image when the contractor
// uploaded one. Shared by both sources — they use the same array convention.
function buildSlides(imageUrls, beforeImageUrls, keyPrefix) {
  return (imageUrls || []).map((imageUrl, i) => {
    const beforeImageUrl = beforeImageUrls?.[i] || null;
    return {
      id: `${keyPrefix}:${i}`,
      imageUrl,
      beforeImageUrl,
      isBeforeAfter: Boolean(beforeImageUrl),
    };
  });
}

function toFeedItem({ kind, row, slides }) {
  const cover = slides[0];
  return {
    id: `${kind === 'POST' ? 'post' : 'project'}:${row.id}`,
    kind,
    postId:    kind === 'POST' ? row.id : null,
    projectId: kind === 'PROJECT' ? row.id : null,
    title: row.title,
    caption: kind === 'POST' ? (row.caption || null) : (row.description || null),
    category: row.category || null,
    costMin: row.costMin,
    costMax: row.costMax,
    slides,
    slideCount: slides.length,
    beforeAfterCount: slides.filter((s) => s.isBeforeAfter).length,
    featured: row.featured,
    createdAt: row.createdAt,
    business: row.business,
    // Legacy cover fields (mirror slides[0]).
    imageUrl: cover.imageUrl,
    beforeImageUrl: cover.beforeImageUrl,
    isBeforeAfter: cover.isBeforeAfter,
  };
}

const feedQuerySchema = z.object({
  category:   z.string().max(60).optional(),
  businessId: z.string().max(64).optional(),
  // 'all' (default) mixes both sources; the others let a client show just
  // contractor posts or just portfolio work.
  source:     z.enum(['all', 'posts', 'projects']).optional(),
  page:       z.coerce.number().int().min(1).max(1000).optional(),
  limit:      z.coerce.number().int().min(1).max(60).optional(),
}).strict();

// GET /feed — page/limit pagination over a capped candidate set. Fine at launch
// scale; revisit with seek pagination if volume grows (see
// docs/RESEARCH_discovery_feed.md).
router.get('/', async (req, res, next) => {
  try {
    const q = feedQuerySchema.parse(req.query);
    const pageNum = q.page || 1;
    const take = q.limit || 30;
    const skip = (pageNum - 1) * take;
    const source = q.source || 'all';

    // Both the content AND its business must be publicly visible — a delisted
    // contractor's photos leave the feed with them.
    const businessWhere = { approvalStatus: 'APPROVED', ...listedWhere() };
    const baseWhere = { approvalStatus: 'APPROVED', business: businessWhere };
    if (q.category) baseWhere.category = q.category;
    if (q.businessId) baseWhere.businessId = q.businessId;

    const CANDIDATE_CAP = 300;
    const [posts, projects] = await Promise.all([
      source === 'projects' ? [] : db.inspirationPost.findMany({
        where: baseWhere,
        orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
        take: CANDIDATE_CAP,
        include: { business: { select: BUSINESS_SELECT } },
      }),
      source === 'posts' ? [] : db.portfolioProject.findMany({
        where: baseWhere,
        orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
        take: CANDIDATE_CAP,
        include: { business: { select: BUSINESS_SELECT } },
      }),
    ]);

    const items = [];
    for (const p of posts) {
      if (!p.business) continue; // safety
      const slides = buildSlides(p.imageUrls, p.beforeImageUrls, p.id);
      if (!slides.length) continue; // a post with no photo has nothing to show
      items.push(toFeedItem({ kind: 'POST', row: p, slides }));
    }
    for (const p of projects) {
      if (!p.business) continue;
      const slides = buildSlides(p.imageUrls, p.beforeImageUrls, p.id);
      if (!slides.length) continue;
      items.push(toFeedItem({ kind: 'PROJECT', row: p, slides }));
    }

    // Interleave the two sources by the same rule each was sorted by, so a
    // contractor's fresh post and a fresh portfolio project compete on equal
    // footing rather than one source always sitting above the other.
    items.sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

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
// inspiration photo to a real lead. Accepts EITHER `inspirationPostId` (a
// native feed post) or `portfolioProjectId` (a portfolio project). Server-side
// this:
//   1. Loads the source content (and verifies the imageUrl belongs to it).
//   2. Uses the posted cost range when it has one, else downloads the photo and
//      runs the Claude vision estimator against it, seeded with the category
//      as the room type.
//   3. Creates an Estimation row owned by the homeowner (AI path only).
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
const quoteThisLookSchema = z.object({
  portfolioProjectId: z.string().min(1).max(64).optional(),
  inspirationPostId:  z.string().min(1).max(64).optional(),
  imageUrl:           z.string().url().max(2048),
}).strict().refine(
  (b) => Boolean(b.portfolioProjectId) !== Boolean(b.inspirationPostId),
  { message: 'Provide exactly one of portfolioProjectId or inspirationPostId' },
);

router.post('/quote-this-look', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { portfolioProjectId, inspirationPostId, imageUrl } = quoteThisLookSchema.parse(req.body);

    const businessInclude = {
      business: {
        select: {
          id: true, userId: true, companyName: true,
          approvalStatus: true, proStatus: true, freeListingEndsAt: true,
        },
      },
    };
    const source = inspirationPostId
      ? await db.inspirationPost.findUnique({ where: { id: inspirationPostId }, include: businessInclude })
      : await db.portfolioProject.findUnique({ where: { id: portfolioProjectId }, include: businessInclude });

    if (!source || source.approvalStatus !== 'APPROVED' || !source.business
        || !isListed(source.business)) {
      return res.status(404).json({ error: 'Not found' });
    }
    // The image must come from this item's own gallery (after or before).
    const allImages = [...source.imageUrls, ...(source.beforeImageUrls || [])];
    if (!allImages.includes(imageUrl)) {
      return res.status(400).json({ error: 'Image is not part of this portfolio project' });
    }

    // Block enforcement (mirrors POST /conversations).
    if (await areBlocked(req.user.id, source.business.userId)) {
      return res.status(403).json({ error: 'Cannot message this user' });
    }

    // Prefer the contractor's own posted range — it's authoritative for their
    // work and saves a Claude call. Only when the item is missing a complete
    // range do we fall back to the AI vision estimator.
    let low  = Number.isFinite(source.costMin) ? Math.round(source.costMin) : null;
    let high = Number.isFinite(source.costMax) ? Math.round(source.costMax) : null;
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
        roomType: source.category || null,
        description: `Inspired by "${source.title}" by ${source.business.companyName}`,
      });
      usedAi = true;
      low  = Number.isFinite(result?.totalLow)  ? Math.round(result.totalLow)  : null;
      high = Number.isFinite(result?.totalHigh) ? Math.round(result.totalHigh) : null;
      estimation = await db.estimation.create({
        data: {
          userId:      req.user.id,
          imageUrls:   [imageUrl],
          roomType:    source.category || null,
          description: `Quote-this-look from "${source.title}"`,
          result,
        },
      });
    }

    // Reuse an open thread if one exists; otherwise open a fresh one.
    const isFirstContact = !(await db.conversation.findUnique({
      where: { clientId_businessId: { clientId: req.user.id, businessId: source.business.id } },
    }));
    const conversation = await db.conversation.upsert({
      where:  { clientId_businessId: { clientId: req.user.id, businessId: source.business.id } },
      create: { clientId: req.user.id, businessId: source.business.id },
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
    const body = `Hi ${source.business.companyName}! I love this look from "${source.title}" and would love a quote on something similar.${range ? ' ' + range : ''} Are you available?`;

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

    if (isFirstContact && source.business.userId) {
      await db.lead.create({
        data: { conversationId: conversation.id, businessId: source.business.id },
      });
      const client = await db.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
      const pushBody = `${client?.name || 'A homeowner'} wants a quote inspired by "${source.title}".`;
      sendPush(source.business.userId, {
        type:  'LEAD',
        title: 'New lead from your portfolio 🎉',
        body:  pushBody,
        data:  { type: 'lead', conversationId: conversation.id },
      }).catch(console.error);
      await recordActivity(source.business.userId, {
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
