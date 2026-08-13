import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getBusiness, type Business } from '@/lib/api';
import { appStoreUrl, hasAppStoreListing } from '@/lib/config';
import { WaitlistForm } from '@/components/WaitlistForm';
import { CheckCircleIcon } from '@/components/Icons';

interface Props { params: { id: string } }

// SEO metadata per profile — this is what makes shared links look good in
// search results, iMessage, and social previews.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const business = await getBusiness(params.id).catch(() => null);
  if (!business) return { title: 'Profile not found' };
  const where = `${business.city}, ${business.state}`;
  return {
    title: business.companyName,
    description: `${business.companyName} — ${where}. ${business.description}`.slice(0, 160),
    alternates: { canonical: `/b/${business.id}` },
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
  const openInApp = business.shareUrl || `https://renovateconnect.com/b/${business.id}`;
  const portfolio = (business.portfolio || []).filter((p) => p.imageUrls.length > 0);
  const reviews = business.reviews || [];

  return (
    <main className="container" style={{ maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={business.logoUrl}
            alt=""
            width={76}
            height={76}
            style={{ borderRadius: 'var(--r-md)', objectFit: 'cover', flex: 'none' }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: 76, height: 76, borderRadius: 'var(--r-md)', flex: 'none',
              background: 'var(--blue-tint)', display: 'grid', placeItems: 'center',
              color: 'var(--blue-text)', fontWeight: 700, fontSize: 30,
            }}
          >
            {business.companyName.charAt(0)}
          </div>
        )}
        <div>
          <h1 style={{ fontSize: 'clamp(1.5rem, 1.3rem + 1vw, 2rem)', marginBottom: 4 }}>
            {business.companyName}
          </h1>
          <div className="muted" style={{ fontSize: '0.9375rem' }}>{where}</div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {business.reviewCount > 0 ? (
              <span>
                <span className="stars">{stars(business.averageRating)}</span>{' '}
                <span className="muted" style={{ fontSize: '0.9375rem' }}>
                  {business.averageRating.toFixed(1)} ({business.reviewCount})
                </span>
              </span>
            ) : (
              <span className="muted" style={{ fontSize: '0.9375rem' }}>No reviews yet</span>
            )}
            {business.verified ? (
              <span className="badge"><CheckCircleIcon size={14} />Verified Pro</span>
            ) : null}
          </div>
        </div>
      </div>

      {/*
        CSLB license number. Required in contractor advertising under CA Bus. &
        Prof. Code § 7030.5, and this public profile is advertising — so it is
        displayed, not tucked into the app.
      */}
      {business.licenseNumber ? (
        <p className="muted" style={{ marginTop: 16, fontSize: '0.875rem' }}>
          CA contractor license{' '}
          <strong className="tabular" style={{ color: 'var(--label)' }}>{business.licenseNumber}</strong>
          {' · '}
          <a
            href={`https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=${encodeURIComponent(business.licenseNumber)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            verify with the CSLB
          </a>
        </p>
      ) : null}

      {hasAppStoreListing ? (
        <div className="btn-row mt-6">
          <a className="btn btn-primary" href={openInApp}>Message &amp; get a quote</a>
          <a className="btn btn-ghost" href={appStoreUrl}>Get the app</a>
        </div>
      ) : null}

      {/* About */}
      <section className="card mt-8">
        <p style={{ marginTop: 0 }}>{business.description}</p>
        <div style={{ marginTop: 14 }}>
          {business.specialties.map((s) => (
            <span className="chip" key={s}>{s}</span>
          ))}
        </div>
        {business.yearsInBusiness > 0 ? (
          <div className="muted" style={{ marginTop: 10, fontSize: '0.875rem' }}>
            {business.yearsInBusiness}+ years in business
          </div>
        ) : null}
      </section>

      {/* Portfolio */}
      {portfolio.length > 0 ? (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: '1.375rem', marginBottom: 14 }}>Recent work</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            {portfolio.slice(0, 6).map((p) => (
              <div className="card card-flush" key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.imageUrls[0]}
                  alt={p.title}
                  style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }}
                  loading="lazy"
                  decoding="async"
                />
                <div style={{ padding: '12px 14px' }}>
                  <strong style={{ fontSize: '0.9375rem' }}>{p.title}</strong>
                  {p.category ? (
                    <div className="muted" style={{ fontSize: '0.8125rem' }}>{p.category}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Reviews */}
      {reviews.length > 0 ? (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: '1.375rem', marginBottom: 14 }}>Reviews</h2>
          {reviews.slice(0, 5).map((r) => (
            <div className="card" key={r.id} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong>{r.authorName}</strong>
                <span className="stars">{stars(r.rating)}</span>
              </div>
              {r.body ? <p style={{ margin: '8px 0 0', fontSize: '0.9375rem' }}>{r.body}</p> : null}
              {r.response ? (
                <div style={{ marginTop: 12, paddingLeft: 14, borderLeft: '3px solid var(--separator-strong)' }}>
                  <div className="muted" style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                    Response from {business!.companyName}
                  </div>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.9375rem' }}>{r.response}</p>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {/* Footer CTA. Before the app exists there is nothing to "open in", so the
          honest ask is an email — not a button that lands on a dead App Store. */}
      {hasAppStoreListing ? (
        <section className="card center mt-8" style={{ background: 'var(--bg-secondary)' }}>
          <h3 style={{ marginBottom: 6 }}>Ready to start your project?</h3>
          <p className="muted" style={{ fontSize: '0.9375rem' }}>
            Get an instant estimate and message {business.companyName} in the app.
          </p>
          <a className="btn btn-primary btn-block mt-4" href={appStoreUrl}>
            Open in RenovateConnect
          </a>
        </section>
      ) : (
        <div className="mt-8">
          <WaitlistForm
            source="business_profile"
            context={business.companyName}
            title={`Want a quote from ${business.companyName}?`}
            subtitle="We’re launching soon in the Bay Area. Leave your email and we’ll introduce you the moment messaging opens up."
            cta="Introduce me at launch"
          />
        </div>
      )}

      <p className="center mt-6">
        <a href="/estimate" style={{ color: 'var(--blue-text)', fontWeight: 600 }}>
          Price your project first with a free photo estimate →
        </a>
      </p>
    </main>
  );
}
