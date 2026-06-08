const router = require('express').Router();
const db = require('../services/db');

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

    const where = { approvalStatus: 'APPROVED' };
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

module.exports = router;
