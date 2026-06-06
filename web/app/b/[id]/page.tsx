import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getBusiness, type Business } from '@/lib/api';
import { appStoreUrl } from '@/lib/config';

interface Props { params: { id: string } }

// SEO metadata per profile — this is what makes shared links look good in
// search results, iMessage, and social previews.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const business = await getBusiness(params.id);
  if (!business) return { title: 'Profile not found' };
  const where = `${business.city}, ${business.state}`;
  return {
    title: business.companyName,
    description: `${business.companyName} — ${where}. ${business.description}`.slice(0, 160),
    openGraph: {
      title: business.companyName,
      description: `${business.companyName} in ${where} on RenovateConnect`,
      images: business.logoUrl ? [business.logoUrl] : undefined,
    },
  };
}

function stars(rating: number): string {
  const full = Math.round(rating);
  return '★★★★★☆☆☆☆☆'.slice(5 - full, 10 - full);
}

export default async function BusinessProfilePage({ params }: Props) {
  let business: Business | null;
  try {
    business = await getBusiness(params.id);
  } catch {
    // API error → treat as not found rather than 500 on a public link.
    business = null;
  }
  if (!business) notFound();

  const where = `${business.city}, ${business.state}`;
  const openInApp = business.shareUrl || `https://renovateconnect.app/b/${business.id}`;
  const portfolio = (business.portfolio || []).filter((p) => p.imageUrls.length > 0);
  const reviews = business.reviews || [];

  return (
    <main className="container">
      {/* Header */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={business.logoUrl}
            alt={business.companyName}
            width={72}
            height={72}
            style={{ borderRadius: 16, objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: 72, height: 72, borderRadius: 16, background: 'var(--primary-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--primary)', fontWeight: 800, fontSize: 28,
            }}
          >
            {business.companyName.charAt(0)}
          </div>
        )}
        <div>
          <h1 style={{ fontSize: 26, margin: '0 0 4px' }}>{business.companyName}</h1>
          <div className="muted">{where}</div>
          <div style={{ marginTop: 6 }}>
            {business.reviewCount > 0 ? (
              <span>
                <span className="stars">{stars(business.averageRating)}</span>{' '}
                <span className="muted">
                  {business.averageRating.toFixed(1)} ({business.reviewCount})
                </span>
              </span>
            ) : (
              <span className="muted">No reviews yet</span>
            )}
            {business.verified ? <span className="badge" style={{ marginLeft: 10 }}>✓ Verified Pro</span> : null}
          </div>
        </div>
      </div>

      {/* Primary CTA — opens the app if installed (universal link), else App Store */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 22 }}>
        <a className="btn btn-primary" href={openInApp}>Message · get a quote</a>
        <a className="btn btn-secondary" href={appStoreUrl}>Get the app</a>
      </div>

      {/* About */}
      <section className="card" style={{ marginTop: 28 }}>
        <p style={{ marginTop: 0 }}>{business.description}</p>
        <div style={{ marginTop: 12 }}>
          {business.specialties.map((s) => (
            <span className="chip" key={s}>{s}</span>
          ))}
        </div>
        {business.yearsInBusiness > 0 ? (
          <div className="muted" style={{ marginTop: 8, fontSize: 14 }}>
            {business.yearsInBusiness}+ years in business
          </div>
        ) : null}
      </section>

      {/* Portfolio */}
      {portfolio.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 20 }}>Recent work</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {portfolio.slice(0, 6).map((p) => (
              <div className="card" key={p.id} style={{ padding: 0, overflow: 'hidden' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.imageUrls[0]}
                  alt={p.title}
                  style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }}
                />
                <div style={{ padding: 12 }}>
                  <strong style={{ fontSize: 14 }}>{p.title}</strong>
                  {p.category ? <div className="muted" style={{ fontSize: 13 }}>{p.category}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Reviews */}
      {reviews.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 20 }}>Reviews</h2>
          {reviews.slice(0, 5).map((r) => (
            <div className="card" key={r.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{r.authorName}</strong>
                <span className="stars">{stars(r.rating)}</span>
              </div>
              {r.body ? <p style={{ margin: '8px 0 0' }}>{r.body}</p> : null}
              {r.response ? (
                <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: '3px solid var(--border)' }}>
                  <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>Response from {business!.companyName}</div>
                  <p style={{ margin: '4px 0 0' }} className="muted">{r.response}</p>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {/* Footer CTA */}
      <section className="card" style={{ marginTop: 32, textAlign: 'center', background: 'var(--bg-soft)' }}>
        <strong>Ready to start your project?</strong>
        <p className="muted" style={{ marginTop: 6 }}>
          Get an instant estimate and message {business.companyName} in the app.
        </p>
        <a className="btn btn-primary btn-block" href={appStoreUrl} style={{ marginTop: 8 }}>
          Open in RenovateConnect
        </a>
      </section>
    </main>
  );
}
