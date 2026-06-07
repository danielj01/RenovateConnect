// Server-side API client. All calls run on the server (SSR), so there's no CORS
// concern and the API base URL is never shipped to the browser.

const API_BASE = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export interface Review {
  id: string;
  authorName: string;
  rating: number;
  body?: string | null;
  verified?: boolean;
  createdAt: string;
  response?: string | null;
}

export interface PortfolioProject {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  costMin?: number | null;
  costMax?: number | null;
  imageUrls: string[];
  featured: boolean;
}

export interface Business {
  id: string;
  companyName: string;
  description: string;
  logoUrl?: string | null;
  city: string;
  state: string;
  specialties: string[];
  averageRating: number;
  reviewCount: number;
  yearsInBusiness: number;
  website?: string | null;
  verified?: boolean;
  reviews?: Review[];
  portfolio?: PortfolioProject[];
  shareUrl?: string;
}

/** Fetch a public business profile. Returns null on 404 (missing/unapproved). */
export async function getBusiness(id: string): Promise<Business | null> {
  const res = await fetch(`${API_BASE}/businesses/${encodeURIComponent(id)}`, {
    // Cache at the edge for 5 min; profiles change rarely and this protects the API.
    next: { revalidate: 300 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} fetching business ${id}`);
  return res.json();
}

export interface SharedEstimate {
  code: string;
  roomType?: string | null;
  result: import('./estimate').EstimateResult;
  createdAt: string;
}

/** Read a saved estimate by its short code. Returns null on 404. */
export async function getSharedEstimate(code: string): Promise<SharedEstimate | null> {
  const res = await fetch(`${API_BASE}/estimations/shared/${encodeURIComponent(code)}`, {
    cache: 'no-store', // each code is fetched once; don't cache misses
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} fetching estimate ${code}`);
  return res.json();
}
