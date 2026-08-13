// Public-facing config derived from env, with safe fallbacks for local dev.

/**
 * Canonical origin for the marketing site.
 *
 * MUST be the www host: renovateconnect.com issues a 308 to
 * www.renovateconnect.com, so canonicals, OG urls, sitemap entries, and the
 * robots.txt sitemap line all have to point here or every crawler hit becomes a
 * redirect hop — and Google may keep treating the two hosts as separate sites.
 */
export const SITE_URL = 'https://www.renovateconnect.com';

export const appStoreUrl =
  process.env.APP_STORE_URL || 'https://apps.apple.com/app/renovateconnect';

export const appleAppStoreId = process.env.APPLE_APP_STORE_ID || '';

/**
 * Whether there is a real App Store listing to link to.
 *
 * There isn't one until an Apple team exists, and the `appStoreUrl` fallback
 * above is a guess that 404s — so every "Get the app" CTA is gated on this.
 * Shipping a dead link on the busiest pages is worse than not offering the app
 * at all. Set APP_STORE_URL (or APPLE_APP_STORE_ID) once the listing is live
 * and the buttons come back on their own.
 */
export const hasAppStoreListing = Boolean(
  process.env.APP_STORE_URL || process.env.APPLE_APP_STORE_ID,
);

export const siteName = 'RenovateConnect';

export const tagline = 'Know the cost first. Hire with confidence. No spam.';
