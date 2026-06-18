import type { Metadata } from 'next';
import { WaitlistForm } from '@/components/WaitlistForm';

export const metadata: Metadata = {
  title: 'Join the waitlist — RenovateConnect',
  description:
    'Be first to know when RenovateConnect launches in your area. Vetted contractors, instant AI estimates, and milestone payment protection.',
};

export default function WaitlistPage() {
  return (
    <main className="container">
      <h1 style={{ fontSize: 32, lineHeight: 1.15, margin: '8px 0 10px' }}>
        We’re launching soon. Get in early.
      </h1>
      <p className="muted" style={{ fontSize: 18, marginTop: 0 }}>
        RenovateConnect matches homeowners with vetted local contractors —
        instant AI estimates, your number never sold, and milestone payment
        protection so funds release only as the work gets done.
      </p>

      <div style={{ marginTop: 24 }}>
        <WaitlistForm
          source="waitlist_page"
          title="Homeowner? Get notified at launch"
          subtitle="We’ll email you the moment we go live in your area. No spam, ever."
          cta="Notify me at launch"
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <WaitlistForm
          source="waitlist_page"
          role="CONTRACTOR"
          title="Contractor? Claim a founding spot"
          subtitle="Founding contractors get a free verified profile and top placement at launch — no lead fees, ever. Leave your email and we’ll reach out to set you up."
          cta="I’m a contractor — keep me posted"
        />
      </div>

      <div className="card" style={{ marginTop: 28 }}>
        <strong>What you’re signing up for</strong>
        <ul className="muted" style={{ marginBottom: 0 }}>
          <li>Instant, itemized AI cost estimates from a photo</li>
          <li>You choose the contractor — your number is never sold or blasted</li>
          <li>Milestone payment protection: funds release as the work gets done</li>
          <li>Admin-verified pros, not pay-to-badge</li>
        </ul>
      </div>

      <p className="muted" style={{ fontSize: 14, marginTop: 24, textAlign: 'center' }}>
        Curious what your project costs?{' '}
        <a href="/estimate" style={{ color: 'var(--primary)', fontWeight: 600 }}>
          Try the free estimator →
        </a>
      </p>
    </main>
  );
}
