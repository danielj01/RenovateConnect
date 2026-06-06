// Curated cost data powering the SEO pages. National-ish base ranges (USD) per
// line item, scaled by a Bay Area metro cost multiplier. These are planning
// ranges for content/SEO — always framed as estimates, never quotes.

export interface Metro {
  slug: string;
  name: string;       // display, e.g. "Oakland"
  /** Cost multiplier vs. the national base ranges below. */
  multiplier: number;
}

export interface CostLineItem { label: string; low: number; high: number }

export interface Category {
  slug: string;
  name: string;       // display, e.g. "Kitchen Remodel"
  noun: string;       // for prose, e.g. "kitchen remodel"
  /** Room type sent to /estimate to prefill the form. */
  roomType: string;
  intro: string;
  items: CostLineItem[];   // national base
  faqs: { q: string; a: string }[];
}

export const metros: Metro[] = [
  { slug: 'san-francisco', name: 'San Francisco', multiplier: 1.45 },
  { slug: 'oakland', name: 'Oakland', multiplier: 1.30 },
  { slug: 'berkeley', name: 'Berkeley', multiplier: 1.35 },
  { slug: 'san-jose', name: 'San Jose', multiplier: 1.35 },
  { slug: 'palo-alto', name: 'Palo Alto', multiplier: 1.50 },
  { slug: 'fremont', name: 'Fremont', multiplier: 1.30 },
];

export const categories: Category[] = [
  {
    slug: 'kitchen',
    name: 'Kitchen Remodel',
    noun: 'kitchen remodel',
    roomType: 'Kitchen',
    intro:
      'Kitchens are the most expensive room to remodel per square foot — cabinets, countertops, and appliances drive most of the cost, and layout changes that move plumbing or gas add more.',
    items: [
      { label: 'Cabinets', low: 4000, high: 15000 },
      { label: 'Countertops', low: 2000, high: 6000 },
      { label: 'Appliances', low: 2500, high: 8000 },
      { label: 'Flooring', low: 1500, high: 5000 },
      { label: 'Plumbing & electrical', low: 1500, high: 5000 },
      { label: 'Labor & installation', low: 4000, high: 12000 },
    ],
    faqs: [
      { q: 'How long does a kitchen remodel take?', a: 'Most kitchen remodels take 4–8 weeks once work begins, plus a few weeks of design and permitting beforehand.' },
      { q: 'What adds the most cost?', a: 'Custom cabinets, stone countertops, and any change that relocates plumbing, gas, or load-bearing walls.' },
      { q: 'Do I need a permit?', a: 'Cosmetic refreshes usually don’t, but moving plumbing/electrical or walls typically requires a permit. A licensed contractor will pull it for you.' },
    ],
  },
  {
    slug: 'bathroom',
    name: 'Bathroom Remodel',
    noun: 'bathroom remodel',
    roomType: 'Bathroom',
    intro:
      'Bathroom cost depends heavily on whether you keep the existing layout. Re-tiling and new fixtures in place is far cheaper than moving the toilet, tub, or shower.',
    items: [
      { label: 'Fixtures (toilet, sink, tub/shower)', low: 1500, high: 6000 },
      { label: 'Tile & flooring', low: 1000, high: 4500 },
      { label: 'Vanity & countertop', low: 800, high: 3500 },
      { label: 'Plumbing & electrical', low: 1000, high: 4000 },
      { label: 'Labor & installation', low: 2500, high: 8000 },
    ],
    faqs: [
      { q: 'How long does a bathroom remodel take?', a: 'A typical bathroom remodel runs 2–4 weeks of active work.' },
      { q: 'Can I save money?', a: 'Keep the existing layout, refinish rather than replace the tub, and choose mid-range tile and fixtures.' },
      { q: 'Is waterproofing included?', a: 'A good contractor includes proper waterproofing behind tile — confirm it’s in the scope to avoid expensive water damage later.' },
    ],
  },
  {
    slug: 'bedroom',
    name: 'Bedroom Remodel',
    noun: 'bedroom remodel',
    roomType: 'Bedroom',
    intro:
      'Bedroom remodels are among the most affordable — most of the budget goes to flooring, paint, closets, and lighting rather than plumbing.',
    items: [
      { label: 'Flooring', low: 1000, high: 4000 },
      { label: 'Paint & wall finishes', low: 600, high: 2500 },
      { label: 'Closet / built-ins', low: 800, high: 4000 },
      { label: 'Lighting & electrical', low: 500, high: 2500 },
      { label: 'Labor', low: 1500, high: 5000 },
    ],
    faqs: [
      { q: 'What’s the biggest variable?', a: 'Custom closets and built-ins, plus flooring choice (carpet vs. hardwood vs. engineered).' },
      { q: 'Do bedroom remodels need permits?', a: 'Usually only if you add or move electrical, change windows, or alter walls.' },
      { q: 'How long does it take?', a: 'Most bedroom updates finish in 1–3 weeks.' },
    ],
  },
  {
    slug: 'living-room',
    name: 'Living Room Remodel',
    noun: 'living room remodel',
    roomType: 'Living room',
    intro:
      'Living room costs scale with square footage and finishes — flooring and built-ins (or a fireplace surround) are usually the biggest line items.',
    items: [
      { label: 'Flooring', low: 1500, high: 6000 },
      { label: 'Paint & finishes', low: 800, high: 3000 },
      { label: 'Lighting & electrical', low: 600, high: 3000 },
      { label: 'Built-ins / fireplace', low: 1000, high: 6000 },
      { label: 'Labor', low: 2000, high: 6000 },
    ],
    faqs: [
      { q: 'What drives living room cost?', a: 'Square footage, flooring material, and any custom millwork like built-in shelving or a fireplace surround.' },
      { q: 'Open-concept changes?', a: 'Removing a wall to open the space adds cost — especially if it’s load-bearing and needs a beam.' },
      { q: 'How long does it take?', a: 'Typically 2–4 weeks, longer if structural changes are involved.' },
    ],
  },
  {
    slug: 'whole-home',
    name: 'Whole-Home Remodel',
    noun: 'whole-home remodel',
    roomType: 'Whole home',
    intro:
      'A whole-home remodel combines every trade at once. Costs vary widely with square footage and how much is structural vs. cosmetic, but doing it together is often cheaper per room than one at a time.',
    items: [
      { label: 'Kitchen', low: 15000, high: 45000 },
      { label: 'Bathrooms', low: 10000, high: 35000 },
      { label: 'Flooring (whole home)', low: 6000, high: 20000 },
      { label: 'Paint, doors & trim', low: 4000, high: 15000 },
      { label: 'Systems (electrical, plumbing, HVAC)', low: 8000, high: 30000 },
      { label: 'Labor & project management', low: 15000, high: 50000 },
    ],
    faqs: [
      { q: 'How long does a whole-home remodel take?', a: 'Plan on 3–6 months for active work on a typical single-family home, plus design and permitting.' },
      { q: 'Is it cheaper to do it all at once?', a: 'Often yes — shared mobilization, permitting, and labor scheduling reduce per-room cost versus separate projects.' },
      { q: 'Should I move out?', a: 'For a full remodel, many homeowners move out for at least part of the project; your contractor can phase it if you stay.' },
    ],
  },
  {
    slug: 'exterior',
    name: 'Exterior & Curb Appeal',
    noun: 'exterior renovation',
    roomType: 'Exterior',
    intro:
      'Exterior projects — siding, paint, windows, roofing, and landscaping — protect the home and drive resale value. Material choice is the biggest cost lever.',
    items: [
      { label: 'Siding or exterior paint', low: 4000, high: 18000 },
      { label: 'Windows & doors', low: 3000, high: 15000 },
      { label: 'Roofing', low: 6000, high: 20000 },
      { label: 'Landscaping & hardscape', low: 2000, high: 12000 },
      { label: 'Labor', low: 4000, high: 14000 },
    ],
    faqs: [
      { q: 'What gives the best resale return?', a: 'Fresh paint or new siding and updated windows consistently rank among the highest-ROI exterior projects.' },
      { q: 'Do I need permits?', a: 'Roofing, structural, and some window/door changes usually require permits; paint and landscaping generally don’t.' },
      { q: 'Best season to do it?', a: 'Dry months are ideal for exterior work — in the Bay Area, late spring through early fall.' },
    ],
  },
];

const round100 = (n: number) => Math.round(n / 100) * 100;

export function metroBySlug(slug: string): Metro | undefined {
  return metros.find((m) => m.slug === slug);
}
export function categoryBySlug(slug: string): Category | undefined {
  return categories.find((c) => c.slug === slug);
}

/** Scale a category's line items + totals by the metro multiplier. */
export function scaledCost(category: Category, metro: Metro) {
  const items = category.items.map((it) => ({
    label: it.label,
    low: round100(it.low * metro.multiplier),
    high: round100(it.high * metro.multiplier),
  }));
  const totalLow = items.reduce((s, it) => s + it.low, 0);
  const totalHigh = items.reduce((s, it) => s + it.high, 0);
  return { items, totalLow, totalHigh };
}

export function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
