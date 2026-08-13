import type { Metadata } from 'next';
import { metros, categories, scaledCost, money } from '@/lib/costData';
import { ArrowRightIcon } from '@/components/Icons';

export const metadata: Metadata = {
  title: 'Bay Area Renovation Cost Guides (2026)',
  description:
    'Real 2026 cost ranges for kitchen, bathroom, and whole-home remodels across San Francisco, Oakland, Berkeley, San Jose, and Palo Alto.',
  alternates: { canonical: '/cost' },
};

// The index used to be a wall of unlabelled chips: you had to click through to
// find out whether a project was $8k or $80k. Showing the range on the link is
// the whole reason someone lands here from search, and it costs nothing —
// every number comes from the same scaledCost() the detail pages use.
export default function CostIndex() {
  return (
    <main className="container">
      <h1>Bay Area renovation cost guides</h1>
      <p className="lede">
        Typical 2026 ranges for a full project, by city. Want a number for your
        exact space? <a href="/estimate">Get a free instant estimate</a> from a photo.
      </p>

      {metros.map((metro) => (
        <section key={metro.slug} style={{ marginTop: 44 }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: 14 }}>{metro.name}</h2>

          <div className="card card-flush">
            {categories.map((category, i) => {
              const { totalLow, totalHigh } = scaledCost(category, metro);
              return (
                <a
                  key={category.slug}
                  className="row-link"
                  href={`/cost/${metro.slug}/${category.slug}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    minHeight: 56,
                    padding: '14px 18px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--separator)',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{category.name}</span>
                  <span
                    className="tabular muted"
                    style={{ whiteSpace: 'nowrap', fontSize: '0.9375rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  >
                    {money(totalLow)} – {money(totalHigh)}
                    <ArrowRightIcon size={15} />
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      ))}

      <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 32 }}>
        Ranges are planning estimates for a standard scope, adjusted for local
        labor and material costs. They are not quotes — only a licensed
        contractor who has seen your space can give you one.
      </p>
    </main>
  );
}
