import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  metros, categories, metroBySlug, categoryBySlug, scaledCost, money,
} from '@/lib/costData';
import { appStoreUrl } from '@/lib/config';

interface Props { params: { metro: string; category: string } }

const YEAR = 2026;

// Pre-render every metro × category combo at build time — fully static, fast,
// and crawlable (the whole point of these pages).
export function generateStaticParams() {
  return metros.flatMap((m) =>
    categories.map((c) => ({ metro: m.slug, category: c.slug })),
  );
}

export function generateMetadata({ params }: Props): Metadata {
  const metro = metroBySlug(params.metro);
  const category = categoryBySlug(params.category);
  if (!metro || !category) return { title: 'Cost guide not found' };
  const { totalLow, totalHigh } = scaledCost(category, metro);
  const title = `${category.name} Cost in ${metro.name} (${YEAR})`;
  return {
    title,
    description: `How much does a ${category.noun} cost in ${metro.name}? Typically ${money(totalLow)}–${money(totalHigh)} in ${YEAR}. See an itemized breakdown and get a free instant estimate.`,
    alternates: { canonical: `/cost/${metro.slug}/${category.slug}` },
    openGraph: { title, type: 'article' },
  };
}

export default function CostPage({ params }: Props) {
  const metro = metroBySlug(params.metro);
  const category = categoryBySlug(params.category);
  if (!metro || !category) notFound();

  const { items, totalLow, totalHigh } = scaledCost(category, metro);
  const estimateHref = `/estimate?room=${encodeURIComponent(category.roomType)}`;

  // FAQPage structured data — eligible for rich results in search.
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: category.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  const otherCategories = categories.filter((c) => c.slug !== category.slug);
  const otherMetros = metros.filter((m) => m.slug !== metro.slug);

  return (
    <main className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <nav className="muted" style={{ fontSize: 13 }}>
        <a href="/cost">Cost guides</a> · {metro.name}
      </nav>

      <h1 style={{ fontSize: 30, lineHeight: 1.15, margin: '8px 0 6px' }}>
        {category.name} Cost in {metro.name} ({YEAR})
      </h1>
      <p style={{ fontSize: 18 }}>
        A {category.noun} in {metro.name} typically runs{' '}
        <strong>{money(totalLow)}–{money(totalHigh)}</strong>, depending on size, finishes, and scope.
      </p>
      <p className="muted">{category.intro}</p>

      <a className="btn btn-primary btn-block" href={estimateHref} style={{ marginTop: 8 }}>
        Get your free instant estimate
      </a>

      {/* Cost table */}
      <h2 style={{ fontSize: 22, marginTop: 30 }}>Typical {category.noun} cost breakdown</h2>
      <div className="card" style={{ padding: 0 }}>
        {items.map((it, i) => (
          <div key={it.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
            <span>{it.label}</span>
            <span style={{ whiteSpace: 'nowrap' }}>{money(it.low)} – {money(it.high)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', borderTop: '2px solid var(--border)', fontWeight: 700, background: 'var(--bg-soft)' }}>
          <span>Total</span>
          <span style={{ whiteSpace: 'nowrap' }}>{money(totalLow)} – {money(totalHigh)}</span>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
        Estimated {YEAR} ranges for {metro.name}, adjusted for local labor and material costs. Your actual cost depends on your specific space — get a photo-based estimate for a tighter number.
      </p>

      {/* FAQ */}
      <h2 style={{ fontSize: 22, marginTop: 30 }}>{category.name} FAQs</h2>
      {category.faqs.map((f) => (
        <div className="card" key={f.q} style={{ marginBottom: 12 }}>
          <strong>{f.q}</strong>
          <p className="muted" style={{ margin: '6px 0 0' }}>{f.a}</p>
        </div>
      ))}

      {/* Conversion */}
      <section className="card" style={{ marginTop: 24, textAlign: 'center', background: 'var(--primary-light)', border: 'none' }}>
        <strong style={{ fontSize: 18 }}>Get a number for your space — free</strong>
        <p className="muted" style={{ marginTop: 6 }}>
          Snap a photo, get an itemized estimate in seconds, then match with vetted {metro.name} contractors. No spam.
        </p>
        <a className="btn btn-primary btn-block" href={estimateHref} style={{ marginTop: 8 }}>
          Start my estimate
        </a>
        <a className="btn btn-secondary btn-block" href={appStoreUrl} style={{ marginTop: 10 }}>
          Get the app
        </a>
      </section>

      {/* Internal links for SEO + discovery */}
      <section style={{ marginTop: 30 }}>
        <h3 style={{ fontSize: 16 }}>Other projects in {metro.name}</h3>
        <p>
          {otherCategories.map((c, i) => (
            <span key={c.slug}>
              <a href={`/cost/${metro.slug}/${c.slug}`}>{c.name} cost</a>{i < otherCategories.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
        <h3 style={{ fontSize: 16, marginTop: 16 }}>{category.name} cost in other cities</h3>
        <p>
          {otherMetros.map((m, i) => (
            <span key={m.slug}>
              <a href={`/cost/${m.slug}/${category.slug}`}>{m.name}</a>{i < otherMetros.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
      </section>
    </main>
  );
}
