// Public-facing config derived from env, with safe fallbacks for local dev.

export const appStoreUrl =
  process.env.APP_STORE_URL || 'https://apps.apple.com/app/renovateconnect';

export const appleAppStoreId = process.env.APPLE_APP_STORE_ID || '';

export const siteName = 'RenovateConnect';

export const tagline = 'Know the cost first. Hire with protection. No spam.';
