'use client';

import { useEffect, useMemo, useState } from 'react';
import { type EstimateResult } from '@/lib/estimate';
import { categories, metroBySlug, metros, scaledCost } from '@/lib/costData';
import { EstimateBreakdown } from '@/components/EstimateBreakdown';
import { WaitlistForm } from '@/components/WaitlistForm';
import { CameraIcon, InfoIcon, ArrowRightIcon } from '@/components/Icons';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const ROOM_TYPES = ['Kitchen', 'Bathroom', 'Bedroom', 'Living room', 'Whole home', 'Exterior', 'Other'];
const MAX_PHOTOS = 5;

/** How the estimate on screen was produced — this drives what we're allowed to claim. */
type Mode = 'ai' | 'guide';

export function EstimateClient() {
  const [files, setFiles] = useState<File[]>([]);
  const [roomType, setRoomType] = useState(ROOM_TYPES[0]);
  const [metroSlug, setMetroSlug] = useState('san-francisco');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [mode, setMode] = useState<Mode>('ai');
  const [error, setError] = useState<string | null>(null);

  // Prefill the room from ?room= (the SEO cost pages link in pre-filled). Read
  // on mount via window so the page stays statically rendered.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room && ROOM_TYPES.includes(room)) setRoomType(room);
    const metro = params.get('metro');
    if (metro && metros.some((m) => m.slug === metro)) setMetroSlug(metro);
  }, []);

  // Object URLs have to be revoked or every re-render leaks one.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  /**
   * The AI estimator can be down (no Anthropic credits, provider outage) — and
   * a dead-end error page is the single most expensive moment on this site.
   * Fall back to the same curated cost data the /cost guides are built from, so
   * the visitor still leaves with a real number. It is labelled as a typical
   * range, never as a read of their photo.
   */
  function guideFallback(): EstimateResult | null {
    const category = categories.find((c) => c.roomType === roomType);
    const metro = metroBySlug(metroSlug);
    if (!category || !metro) return null;
    const { items, totalLow, totalHigh } = scaledCost(category, metro);
    return {
      summary:
        `Our photo estimator is offline right now, so this is the typical ${metro.name} range for a `
        + `${category.noun} from our cost guides — not a read of your photos. It's a solid planning `
        + `number while we get the estimator back up.`,
      lineItems: items.map((it) => ({ item: it.label, low: it.low, high: it.high })),
      totalLow,
      totalHigh,
      currency: 'USD',
      notes:
        'Ranges assume a standard scope with no structural or permit surprises. '
        + 'A licensed contractor quoting your actual space is the only real number.',
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) { setError('Add at least one photo of the space.'); return; }
    setStatus('loading');
    setError(null);
    try {
      const form = new FormData();
      files.slice(0, MAX_PHOTOS).forEach((f) => form.append('images', f));
      form.append('roomType', roomType);
      // The API takes no city field, but `description` feeds the model — and Bay
      // Area labor swings ~15% between these cities, so the city belongs in the
      // prompt rather than only in the offline fallback.
      const metroName = metroBySlug(metroSlug)?.name;
      const detail = [metroName ? `Location: ${metroName}, CA.` : '', description]
        .filter(Boolean).join(' ').slice(0, 2000);
      if (detail) form.append('description', detail);

      const res = await fetch(`${API_BASE}/estimations/guest`, { method: 'POST', body: form });

      if (res.status === 429) {
        setStatus('error');
        setError('You’ve used up the free estimates for now. Try again a bit later, or join the waitlist and we’ll match you with a pro at launch.');
        return;
      }
      if (!res.ok) throw new Error(`estimate failed (${res.status})`);

      const data = await res.json();
      setResult(data.result as EstimateResult);
      setMode('ai');
      setStatus('done');
    } catch {
      const fallback = guideFallback();
      if (fallback) {
        setResult(fallback);
        setMode('guide');
        setStatus('done');
        return;
      }
      setStatus('error');
      setError('Our estimator is offline right now. Join the waitlist and we’ll send you a real quote from a local pro at launch.');
    }
  }

  function reset() {
    setFiles([]);
    setResult(null);
    setError(null);
    setStatus('idle');
    setDescription('');
    setMode('ai');
  }

  if (status === 'done' && result) {
    return <ResultView result={result} roomType={roomType} mode={mode} onReset={reset} />;
  }

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <h1>Get your instant estimate</h1>
      <p className="lede">
        Add a photo of the space and we&rsquo;ll return an itemized cost range in
        seconds. Free, and no account needed.
      </p>

      <form onSubmit={submit} className="mt-8">
        <label
          className="card"
          style={{
            display: 'block',
            cursor: 'pointer',
            textAlign: 'center',
            borderStyle: 'dashed',
            borderWidth: 2,
            padding: files.length ? 16 : 34,
            background: 'var(--bg-secondary)',
          }}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            // `capture` hints the rear camera on mobile browsers.
            capture="environment"
            className="visually-hidden"
            onChange={(e) => {
              setFiles(Array.from(e.target.files || []).slice(0, MAX_PHOTOS));
              setError(null);
            }}
          />
          {files.length === 0 ? (
            <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <span className="feature-icon" style={{ marginBottom: 0 }}><CameraIcon /></span>
              <strong>Add up to {MAX_PHOTOS} photos</strong>
              <span className="muted" style={{ fontSize: '0.875rem' }}>
                Tap to take one or choose from your library
              </span>
            </span>
          ) : (
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
              {previews.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={src}
                  src={src}
                  alt={`Photo ${i + 1} of the space`}
                  style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 'var(--r-sm)' }}
                />
              ))}
              <span className="muted" style={{ fontSize: '0.875rem', width: '100%', marginTop: 8 }}>
                {files.length} photo{files.length === 1 ? '' : 's'} — tap to change
              </span>
            </span>
          )}
        </label>

        <div className="mt-6">
          <label className="field" htmlFor="room">
            <span>Room or project</span>
            <select id="room" value={roomType} onChange={(e) => setRoomType(e.target.value)}>
              {ROOM_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>

          <label className="field" htmlFor="metro">
            <span>City</span>
            <select id="metro" value={metroSlug} onChange={(e) => setMetroSlug(e.target.value)}>
              {metros.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
            </select>
          </label>

          <label className="field" htmlFor="detail">
            <span>Anything specific? <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></span>
            <textarea
              id="detail"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. replace the cabinets and countertops, keep the layout"
              rows={3}
            />
          </label>
        </div>

        {error ? <p className="form-error" role="alert">{error}</p> : null}

        <button type="submit" className="btn btn-primary btn-block mt-6" disabled={status === 'loading'}>
          {status === 'loading' ? 'Analyzing your photos…' : 'Get my estimate'}
        </button>
        <p className="form-note">
          Estimates are AI-generated planning ranges, not quotes. Photos are used
          for the estimate and not published.
        </p>
      </form>

      {status === 'error' ? (
        <div className="mt-8">
          <WaitlistForm
            source="estimate_error"
            context={roomType}
            title="Get matched at launch instead"
            subtitle="Leave your email and we’ll introduce you to a licensed local contractor the moment we go live."
            cta="Match me at launch"
          />
        </div>
      ) : null}
    </main>
  );
}

function ResultView({
  result, roomType, mode, onReset,
}: { result: EstimateResult; roomType: string; mode: Mode; onReset: () => void }) {
  return (
    <main className="container" style={{ maxWidth: 640 }}>
      {mode === 'guide' ? (
        <div className="notice notice-info" style={{ marginBottom: 22 }}>
          <InfoIcon />
          <span>
            <strong>This is a cost-guide range, not a photo estimate.</strong> Our AI
            estimator is temporarily offline, so we&rsquo;ve pulled the typical range for
            this project instead.
          </span>
        </div>
      ) : null}

      <EstimateBreakdown result={result} />

      {/* Pre-launch conversion gate — capture the email now, match them at
          launch. Carries the room type as context so we know what they want. */}
      <div className="mt-8">
        <WaitlistForm
          source={mode === 'guide' ? 'estimate_guide' : 'estimate'}
          context={roomType}
          title="Want a real quote for this?"
          subtitle="We’re launching soon with licensed local contractors and no lead-selling. Leave your email and we’ll match you the moment we go live in your area."
          cta="Match me at launch"
        />
      </div>

      <div className="btn-row mt-4">
        <button onClick={onReset} className="btn btn-secondary btn-block">
          Estimate another space
        </button>
      </div>

      <p className="center mt-6">
        <a href="/cost" style={{ color: 'var(--blue-text)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          See full Bay Area cost guides <ArrowRightIcon size={15} />
        </a>
      </p>
    </main>
  );
}
