import type { Metadata } from 'next';
import { metros, categories } from '@/lib/costData';

export const metadata: Metadata = {
  title: 'Bay Area Renovation Cost Guides (2026)',
  description:
    'Real 2026 cost ranges for kitchen, bathroom, and whole-home remodels across the Bay Area — plus a free instant photo estimate.',
  alternates: { canonical: '/cost' },
};

export default function CostIndex() {
  return (
    <main className="container">
      <h1 style={{ fontSize: 30, margin: '8px 0 6px' }}>Bay Area renovation cost guides</h1>
      <p className="muted" style={{ fontSize: 18, marginTop: 0 }}>
        Typical 2026 cost ranges by project and city. Want a number for your exact
        space? <a href="/estimate">Get a free instant estimate</a>.
      </p>

      {metros.map((m) => (
        <section key={m.slug} style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 20 }}>{m.name}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {categories.map((c) => (
              <a key={c.slug} className="chip" href={`/cost/${m.slug}/${c.slug}`}>
                {c.name} cost
              </a>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
