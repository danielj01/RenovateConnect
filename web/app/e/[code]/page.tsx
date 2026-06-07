import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSharedEstimate } from '@/lib/api';
import { EstimateBreakdown } from '@/components/EstimateBreakdown';
import { formatCode, money } from '@/lib/estimate';
import { appStoreUrl } from '@/lib/config';

interface Props { params: { code: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const est = await getSharedEstimate(params.code).catch(() => null);
  if (!est) return { title: 'Saved estimate' };
  const r = est.roomType ? `${est.roomType} ` : '';
  return {
    title: `Your ${r}estimate`,
    description: `${money(est.result.totalLow)}–${money(est.result.totalHigh)} estimated. Open in the RenovateConnect app to get matched with vetted pros.`,
    robots: { index: false }, // private per-user content — don't index
  };
}

export default async function SavedEstimatePage({ params }: Props) {
  const est = await getSharedEstimate(params.code).catch(() => null);
  if (!est) notFound();

  // This page's own URL is a universal link — tapping the button opens the app
  // (if installed) straight to this estimate; otherwise it stays on the web page.
  const openInApp = `https://renovateconnect.app/e/${est.code}`;

  return (
    <main className="container">
      <h1 style={{ fontSize: 26, margin: '8px 0 12px' }}>
        Your {est.roomType ? `${est.roomType.toLowerCase()} ` : ''}estimate is saved
      </h1>

      <EstimateBreakdown result={est.result} />

      {/* Primary handoff for already-installed users. */}
      <a className="btn btn-primary btn-block" href={openInApp} style={{ marginTop: 22 }}>
        Open in the app & get matched
      </a>

      {/* New-install fallback: App Store + the short code to type in. */}
      <section className="card" style={{ marginTop: 14, textAlign: 'center' }}>
        <p className="muted" style={{ marginTop: 0 }}>Don’t have the app yet?</p>
        <a className="btn btn-secondary btn-block" href={appStoreUrl}>Get RenovateConnect</a>
        <p className="muted" style={{ fontSize: 14, marginTop: 14 }}>
          Then tap “Have an estimate?” and enter this code:
        </p>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2, color: 'var(--primary)' }}>
          {formatCode(est.code)}
        </div>
      </section>

      <p className="muted" style={{ fontSize: 13, marginTop: 16, textAlign: 'center' }}>
        Estimates are AI-generated ranges to help you plan — not a quote.
      </p>
    </main>
  );
}
