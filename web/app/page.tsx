// Minimal landing for v1. The full AI-estimator front door (build A, Phase 2)
// lands here later; for now this gives the domain a real home and a path to the
// estimator + waitlist while the SSR /b/:id profile pages do the heavy lifting
// for shared links.

const features = [
  {
    title: 'Instant AI estimate',
    body: 'Snap a photo of the space. Get an itemized cost range in seconds — before you call anyone.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9a2 2 0 0 1 2-2h1.5l1-1.5h9l1 1.5H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
    ),
  },
  {
    title: 'Admin-verified pros',
    body: 'Every contractor is reviewed before they’re listed — verification is earned, not for sale.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 4.5 6v6c0 4.5 3.1 7.9 7.5 9 4.4-1.1 7.5-4.5 7.5-9V6Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'Talk directly, no middleman',
    body: 'Your number is never sold or blasted. You choose the contractor and pay them directly.',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 12h.01M12 12h.01M16 12h.01" />
        <path d="M21 12a8 8 0 1 1-3.3-6.5L21 4l-1.2 4.1A7.96 7.96 0 0 1 21 12Z" />
      </svg>
    ),
  },
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <span className="badge">Bay Area · Free to use</span>
          <h1 style={{ fontSize: 40, lineHeight: 1.12, margin: '14px 0 14px', maxWidth: 560 }}>
            Know what your renovation will cost — before you call anyone.
          </h1>
          <p className="muted" style={{ fontSize: 18, marginTop: 0, maxWidth: 480 }}>
            Snap a photo, get an instant AI estimate, then connect directly with a
            vetted Bay Area contractor. No spam. No lead-selling.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 28 }}>
            <a className="btn btn-primary" href="/estimate">Get an instant estimate</a>
            <a className="btn btn-secondary" href="/waitlist">Join the waitlist</a>
          </div>

          <div className="trust-row">
            <span className="trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              No cost to homeowners
            </span>
            <span className="trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              Your info is never sold
            </span>
            <span className="trust-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              Admin-verified contractors
            </span>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 56 }}>
        <h2 className="section-title">Why RenovateConnect</h2>
        <p className="section-subtitle muted">
          Built so homeowners get real numbers fast, and good contractors get real leads —
          not sold-and-resold ones.
        </p>
        <div className="feature-grid">
          {features.map((f) => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <strong style={{ fontSize: 17 }}>{f.title}</strong>
              <p className="muted" style={{ fontSize: 15, marginTop: 6, marginBottom: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <h2 style={{ fontSize: 24 }}>Ready to see what your project costs?</h2>
        <p>Free, instant, and no account required.</p>
        <a
          className="btn btn-primary"
          href="/estimate"
          style={{ background: '#fff', color: 'var(--primary-dark)' }}
        >
          Get an instant estimate
        </a>
      </section>
    </>
  );
}
