import { appStoreUrl } from '@/lib/config';

// Minimal landing for v1. The full AI-estimator front door (build A, Phase 2)
// lands here later; for now this gives the domain a real home and a path to the
// app while the SSR /b/:id profile pages do the heavy lifting for shared links.
export default function Home() {
  return (
    <main className="container">
      <h1 style={{ fontSize: 34, lineHeight: 1.15, margin: '8px 0 12px' }}>
        Know what your renovation will cost — before you call anyone.
      </h1>
      <p className="muted" style={{ fontSize: 18, marginTop: 0 }}>
        Snap a photo, get an instant AI estimate, then hire a vetted Bay Area
        contractor with payment protection. No spam. No lead-selling.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 24 }}>
        <a className="btn btn-primary" href="/estimate">Get an instant estimate</a>
        <a className="btn btn-secondary" href={appStoreUrl}>Get the app</a>
      </div>

      <div className="card" style={{ marginTop: 40 }}>
        <strong>Why RenovateConnect</strong>
        <ul className="muted" style={{ marginBottom: 0 }}>
          <li>Instant, itemized AI cost estimates from a photo</li>
          <li>You choose the contractor — your number is never sold or blasted</li>
          <li>Milestone payment protection: funds release as the work gets done</li>
          <li>Admin-verified pros, not pay-to-badge</li>
        </ul>
      </div>
    </main>
  );
}
