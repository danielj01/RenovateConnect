// Shared estimate types + helpers used by both the live estimator (/estimate)
// and the saved-estimate page (/e/[code]).

export interface LineItem { item: string; low: number; high: number; unit?: string }

export interface EstimateResult {
  summary: string;
  lineItems: LineItem[];
  totalLow: number;
  totalHigh: number;
  currency?: string;
  confidence?: string;
  notes?: string;
}

export function money(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 0,
  }).format(n);
}

/** Display form for a share code: "ABCD-2345". */
export function formatCode(code: string): string {
  const c = code.toUpperCase();
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}
