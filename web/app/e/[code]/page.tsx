import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSharedEstimate } from '@/lib/api';
import { EstimateBreakdown } from '@/components/EstimateBreakdown';
import { formatCode, money } from '@/lib/estimate';
import { appStoreUrl, hasAppStoreListing } from '@/lib/config';
import { WaitlistForm } from '@/components/WaitlistForm';

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
  const openInApp = `https://renovateconnect.com/e/${est.code}`;

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 'clamp(1.625rem, 1.4rem + 1vw, 2rem)' }}>
        Your {est.roomType ? `${est.roomType.toLowerCase()} ` : ''}estimate is saved
      </h1>

      <div className="mt-6">
        <EstimateBreakdown result={est.result} />
      </div>

      {hasAppStoreListing ? (
        <>
          {/* Primary handoff for already-installed users. */}
          <a className="btn btn-primary btn-block mt-8" href={openInApp}>
            Open in the app &amp; get matched
          </a>

          {/* New-install fallback: App Store + the short code to type in. */}
          <section className="card center mt-4">
            <p className="muted">Don&rsquo;t have the app yet?</p>
            <a className="btn btn-secondary btn-block" href={appStoreUrl}>Get RenovateConnect</a>
            <p className="muted" style={{ fontSize: '0.875rem', marginTop: 14 }}>
              Then tap &ldquo;Have an estimate?&rdquo; and enter this code:
            </p>
            <div className="tabular" style={{ fontSize: '1.625rem', fontWeight: 700, letterSpacing: 2, color: 'var(--blue-text)' }}>
              {formatCode(est.code)}
            </div>
          </section>
        </>
      ) : (
        // Pre-launch there is no app to open, so the code alone is a dead end.
        // Capture the email instead and keep the code visible for later.
        <>
          <div className="mt-8">
            <WaitlistForm
              source="saved_estimate"
              context={est.roomType || undefined}
              title="Get matched with a local pro"
              subtitle="We’re launching soon with licensed Bay Area contractors. Leave your email and we’ll bring this estimate with you."
              cta="Match me at launch"
            />
          </div>

          <p className="muted center mt-6" style={{ fontSize: '0.875rem' }}>
            Your estimate code — keep it to reopen this page later:{' '}
            <strong className="tabular" style={{ color: 'var(--blue-text)', letterSpacing: 1 }}>
              {formatCode(est.code)}
            </strong>
          </p>
        </>
      )}

      <p className="muted center mt-6" style={{ fontSize: '0.8125rem' }}>
        Estimates are AI-generated ranges to help you plan — not a quote.
      </p>
    </main>
  );
}
