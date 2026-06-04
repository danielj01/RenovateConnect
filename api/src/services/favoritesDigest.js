// "What's new with your saved contractors" — the favorites digest.
//
// This is a pull-based summary (no per-event push). For each business a
// homeowner has favorited, we surface portfolio projects and reviews that
// appeared *after* they started following it and that they haven't seen yet.
//
// The functions here are pure so the date/threshold logic can be unit-tested
// without a database; the route layer feeds them rows it loaded via Prisma.

// How many sample items of each kind we embed per business (counts are exact).
const SAMPLE_LIMIT = 5;

// The cutoff for "new" on a single favorited business: the later of when the
// homeowner saved the business and when they last viewed the digest. Using the
// favorite's own creation time as a floor means a freshly-saved contractor
// doesn't dump its entire back catalogue into the digest.
function digestSince(favoriteCreatedAt, seenAt) {
  const saved = new Date(favoriteCreatedAt).getTime();
  const seen = seenAt ? new Date(seenAt).getTime() : 0;
  return new Date(Math.max(saved, seen));
}

// True when `createdAt` is strictly after the cutoff.
function isNewSince(createdAt, since) {
  return new Date(createdAt).getTime() > new Date(since).getTime();
}

function projectSummary(p) {
  return {
    id: p.id,
    title: p.title,
    category: p.category ?? null,
    imageUrls: p.imageUrls ?? [],
    createdAt: p.createdAt,
  };
}

function reviewSummary(r) {
  return {
    id: r.id,
    rating: r.rating,
    body: r.body ?? null,
    authorName: r.authorName,
    createdAt: r.createdAt,
  };
}

// Build a single business's digest entry from its loaded projects + reviews.
// `since` is the cutoff from digestSince(). Returns the entry shape the API
// serves, including a `hasUpdates` flag and a `latestAt` for sorting.
function summarizeBusiness({ business, projects = [], reviews = [], since }) {
  const newProjects = projects
    .filter((p) => isNewSince(p.createdAt, since))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const newReviews = reviews
    .filter((r) => isNewSince(r.createdAt, since))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const timestamps = [...newProjects, ...newReviews].map((x) => new Date(x.createdAt).getTime());
  const latestAt = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;

  return {
    business: {
      id: business.id,
      companyName: business.companyName,
      logoUrl: business.logoUrl ?? null,
      city: business.city,
      state: business.state,
      averageRating: business.averageRating,
      reviewCount: business.reviewCount,
      verified: business.verified,
    },
    since: new Date(since).toISOString(),
    newProjectCount: newProjects.length,
    newReviewCount: newReviews.length,
    newProjects: newProjects.slice(0, SAMPLE_LIMIT).map(projectSummary),
    newReviews: newReviews.slice(0, SAMPLE_LIMIT).map(reviewSummary),
    latestAt,
    hasUpdates: newProjects.length + newReviews.length > 0,
  };
}

module.exports = { digestSince, isNewSince, summarizeBusiness, SAMPLE_LIMIT };
