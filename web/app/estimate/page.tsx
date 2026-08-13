import type { Metadata } from 'next';
import { EstimateClient } from '@/components/EstimateClient';

// The estimator itself is interactive (file input, fetch, result state), so it
// lives in a client component. This server wrapper exists purely so the page
// still ships real metadata — /estimate is a top-of-funnel landing page and a
// `'use client'` page can't export any.
export const metadata: Metadata = {
  title: 'Free instant renovation estimate from a photo',
  description:
    'Snap a photo of your kitchen, bathroom, or any room and get an itemized renovation cost range in seconds. Free, no account needed, Bay Area pricing.',
  alternates: { canonical: '/estimate' },
  openGraph: {
    title: 'Free instant renovation estimate from a photo',
    description:
      'Get an itemized renovation cost range in seconds — free, no account needed.',
    images: [{ url: '/img/kitchen.jpg', width: 1600, height: 1000, alt: 'A renovated kitchen' }],
  },
};

export default function EstimatePage() {
  return <EstimateClient />;
}
