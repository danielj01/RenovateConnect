import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  metros, categories, metroBySlug, categoryBySlug, scaledCost, money,
} from '@/lib/costData';
import { appStoreUrl, hasAppStoreListing, SITE_URL } from '@/lib/config';

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
  // Carry the city through too, so the estimator (and its offline cost-guide
  // fallback) prices the same metro the visitor was just reading about.
  const estimateHref = `/estimate?room=${encodeURIComponent(category.roomType)}&metro=${metro.slug}`;

  // FAQPage + BreadcrumbList structured data — both are eligible for rich
  // results, and the breadcrumb is what turns the ugly URL in the SERP into
  // "Cost guides › San Francisco › Kitchen Remodel".
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        mainEntity: category.faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Cost guides', item: `${SITE_URL}/cost` },
          { '@type': 'ListItem', position: 2, name: metro.name, item: `${SITE_URL}/cost/${metro.slug}/${category.slug}` },
          { '@type': 'ListItem', position: 3, name: category.name },
        ],
      },
    ],
  };

  const otherCategories = categories.filter((c) => c.slug !== category.slug);
  const otherMetros = metros.filter((m) => m.slug !== metro.slug);

  return (
    <main className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav className="muted" style={{ fontSize: '0.8125rem' }}>
        <a href="/cost">Cost guides</a> · {metro.name}
      </nav>

      <h1 style={{ fontSize: 'clamp(1.75rem, 1.4rem + 1.6vw, 2.5rem)', marginTop: 10 }}>
        {category.name} Cost in {metro.name} ({YEAR})
      </h1>
      <p className="lede">
        A {category.noun} in {metro.name} typically runs{' '}
        <strong style={{ color: 'var(--label)' }}>{money(totalLow)}–{money(totalHigh)}</strong>,
        depending on size, finishes, and scope.
      </p>
      <p className="muted">{category.intro}</p>

      <a className="btn btn-primary btn-block mt-6" href={estimateHref}>
        Get your free instant estimate
      </a>

      {/* Cost table */}
      <h2 style={{ fontSize: '1.375rem', marginTop: 40 }}>Typical {category.noun} cost breakdown</h2>
      <div className="card card-flush">
        {items.map((it, i) => (
          <div key={it.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--separator)' }}>
            <span style={{ fontSize: '0.9375rem' }}>{it.label}</span>
            <span className="tabular" style={{ whiteSpace: 'nowrap', fontSize: '0.9375rem' }}>{money(it.low)} – {money(it.high)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '16px 18px', borderTop: '1px solid var(--separator-strong)', fontWeight: 700, background: 'var(--bg-secondary)' }}>
          <span>Total</span>
          <span className="tabular" style={{ whiteSpace: 'nowrap' }}>{money(totalLow)} – {money(totalHigh)}</span>
        </div>
      </div>
      <p className="muted" style={{ fontSize: '0.8125rem', marginTop: 10 }}>
        Estimated {YEAR} ranges for {metro.name}, adjusted for local labor and material costs. Your actual cost depends on your specific space — get a photo-based estimate for a tighter number.
      </p>

      {/* FAQ */}
      <h2 style={{ fontSize: '1.375rem', marginTop: 40 }}>{category.name} FAQs</h2>
      {category.faqs.map((f) => (
        <div className="card" key={f.q} style={{ marginBottom: 12 }}>
          <strong>{f.q}</strong>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.9375rem' }}>{f.a}</p>
        </div>
      ))}

      {/* Conversion */}
      <section className="card center mt-8" style={{ background: 'var(--blue-tint)', border: 'none' }}>
        <h3 style={{ marginBottom: 6 }}>Get a number for your space — free</h3>
        <p className="muted" style={{ fontSize: '0.9375rem' }}>
          Snap a photo, get an itemized estimate in seconds, then connect with licensed {metro.name} contractors. No spam, no lead-selling.
        </p>
        <a className="btn btn-primary btn-block mt-4" href={estimateHref}>
          Start my estimate
        </a>
        {hasAppStoreListing ? (
          <a className="btn btn-secondary btn-block mt-4" href={appStoreUrl}>
            Get the app
          </a>
        ) : (
          <a className="btn btn-secondary btn-block mt-4" href="/waitlist">
            Join the waitlist
          </a>
        )}
      </section>

      {/* Internal links for SEO + discovery */}
      <section style={{ marginTop: 40 }}>
        <h3 style={{ fontSize: '1rem' }}>Other projects in {metro.name}</h3>
        <p>
          {otherCategories.map((c, i) => (
            <span key={c.slug}>
              <a href={`/cost/${metro.slug}/${c.slug}`}>{c.name} cost</a>{i < otherCategories.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </p>
        <h3 style={{ fontSize: '1rem', marginTop: 24 }}>{category.name} cost in other cities</h3>
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
