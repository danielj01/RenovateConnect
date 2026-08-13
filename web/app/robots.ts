import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  return {
    // One group per user-agent. Two separate `User-Agent: *` blocks is
    // ambiguous — some crawlers merge them, others take only the first — so the
    // allow and the disallows belong in the same rule.
    //
    // /e/ holds private per-user saved estimates behind a share code, and /api
    // has nothing worth indexing.
    rules: [{ userAgent: '*', allow: '/', disallow: ['/e/', '/api/'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
