import type { MetadataRoute } from 'next';
import { metros, categories } from '@/lib/costData';

const BASE = 'https://renovateconnect.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = ['', '/estimate', '/cost'].map((p) => ({
    url: `${BASE}${p}`,
    changeFrequency: 'weekly',
    priority: p === '' ? 1 : 0.8,
  }));

  const costPages: MetadataRoute.Sitemap = metros.flatMap((m) =>
    categories.map((c) => ({
      url: `${BASE}/cost/${m.slug}/${c.slug}`,
      changeFrequency: 'monthly',
      priority: 0.7,
    })),
  );

  return [...staticPages, ...costPages];
}
