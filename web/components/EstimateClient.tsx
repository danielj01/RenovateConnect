'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { type EstimateResult } from '@/lib/estimate';
import { categories, metroBySlug, metros, scaledCost } from '@/lib/costData';
import { EstimateBreakdown } from '@/components/EstimateBreakdown';
import { WaitlistForm } from '@/components/WaitlistForm';
import { BoltIcon, CameraIcon, InfoIcon, ArrowRightIcon } from '@/components/Icons';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const ROOM_TYPES = ['Kitchen', 'Bathroom', 'Bedroom', 'Living room', 'Whole home', 'Exterior', 'Other'];
const MAX_PHOTOS = 5;

/**
 * Finish level. Shares the LOW/MEDIUM/HIGH vocabulary with contractor price
 * tier (the API's services/costTier.js) so there's one scale across the app.
 * Pinning this is what lets the estimator quote a tight range instead of
 * hedging across every possible spec — the examples are shown because "budget"
 * means very different things to different people.
 */
type CostTier = 'LOW' | 'MEDIUM' | 'HIGH';
const TIERS: { value: CostTier; dollars: string; label: string; hint: string }[] = [
  { value: 'LOW', dollars: '$', label: 'Budget', hint: 'Stock cabinets, laminate counters' },
  { value: 'MEDIUM', dollars: '$$', label: 'Mid-range', hint: 'Quartz counters, semi-custom cabinets' },
  { value: 'HIGH', dollars: '$$$', label: 'High-end', hint: 'Stone counters, custom cabinetry' },
];

const LOADING_MESSAGES = [
  'Analyzing your photos…',
  'Identifying materials and condition…',
  'Estimating labor and material costs…',
  'Pricing out the details…',
  'Wrapping up your estimate…',
];
/** How long the bar takes to glide to its holding point, in ms. */
const CLIMB_MS = 22_000;
/** Where it stops and waits. Never 100 — the request isn't finished yet. */
const CLIMB_TARGET = 93;
const MESSAGE_EVERY_MS = 3_200;

/** How the estimate on screen was produced — this drives what we're allowed to claim. */
type Mode = 'ai' | 'guide';

export function EstimateClient() {
  const [files, setFiles] = useState<File[]>([]);
  const [roomType, setRoomType] = useState(ROOM_TYPES[0]);
  // Mid-range by default: the most common choice, and it means the estimate is
  // narrow out of the box rather than only once someone finds this control.
  const [costTier, setCostTier] = useState<CostTier>('MEDIUM');
  const [metroSlug, setMetroSlug] = useState('san-francisco');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [mode, setMode] = useState<Mode>('ai');
  const [error, setError] = useState<string | null>(null);
  // Flips once the request has actually landed, so the bar can visibly finish
  // instead of cutting away mid-climb.
  const [loadDone, setLoadDone] = useState(false);

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

  /** Let the bar reach 100% and register before the result replaces it. */
  async function finishLoading() {
    setLoadDone(true);
    await new Promise((r) => setTimeout(r, 600));
    setStatus('done');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) { setError('Add at least one photo of the space.'); return; }
    setStatus('loading');
    setLoadDone(false);
    setError(null);
    try {
      const form = new FormData();
      files.slice(0, MAX_PHOTOS).forEach((f) => form.append('images', f));
      form.append('roomType', roomType);
      form.append('costTier', costTier);
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
      await finishLoading();
    } catch {
      const fallback = guideFallback();
      if (fallback) {
        setResult(fallback);
        setMode('guide');
        await finishLoading();
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
    setLoadDone(false);
    setDescription('');
    setMode('ai');
  }

  if (status === 'done' && result) {
    return <ResultView result={result} roomType={roomType} mode={mode} onReset={reset} />;
  }

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      {/* Heading and lede both drop out while the estimate runs — the loading
          view is its own full statement and doesn't need a form title over it. */}
      {status !== 'loading' ? (
        <>
          <h1>Get your instant estimate</h1>
          <p className="lede">
            Add a photo of the space and we&rsquo;ll return an itemized cost range in
            seconds. Free, and no account needed.
          </p>
        </>
      ) : null}

      {status === 'loading' ? <EstimateLoading done={loadDone} /> : (
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

          <fieldset className="field tier-field">
            <legend>Finish level</legend>
            <div className="tier-group">
              {TIERS.map((t) => (
                <label
                  key={t.value}
                  className={`tier-option${costTier === t.value ? ' is-selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="costTier"
                    value={t.value}
                    checked={costTier === t.value}
                    onChange={() => setCostTier(t.value)}
                    className="visually-hidden"
                  />
                  <span className="tier-dollars">{t.dollars}</span>
                  <span className="tier-label">{t.label}</span>
                  <span className="tier-hint">{t.hint}</span>
                </label>
              ))}
            </div>
            <p className="tier-note">
              Telling us the finish level is the single biggest thing you can do
              to narrow the range — it&rsquo;s what most of the spread comes from.
            </p>
          </fieldset>

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

        {/* No in-button loading state: the whole form is replaced by
            <EstimateLoading /> while the request is in flight. */}
        <button type="submit" className="btn btn-primary btn-block mt-6">
          Get my estimate
        </button>
        <p className="form-note">
          Estimates are AI-generated planning ranges, not quotes. Photos are used
          for the estimate and not published.
        </p>
      </form>
      )}

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

/**
 * Progress that isn't real progress — the API returns no intermediate signal.
 * The bar glides toward, but never reaches, CLIMB_TARGET and holds there for as
 * long as the request takes, so a slow response reads as "still working" rather
 * than frozen or finished.
 *
 * The climb runs per-frame off one continuous easing curve rather than a series
 * of stepped CSS transitions — restarting a transition every tick decelerates
 * to a stop and jump-starts again, which reads as stuttering. Width is written
 * straight to the node so 60fps updates don't re-render React; the percentage
 * is state, but React bails on a setState that doesn't change the value, so
 * that's ~93 renders across the whole run rather than ~1,300.
 */
function EstimateLoading({ done }: { done: boolean }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [reducedMotion] = useState(
    () => typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (done || reducedMotion) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / CLIMB_MS, 1);
      const value = (1 - (1 - t) ** 3) * CLIMB_TARGET; // easeOutCubic
      if (fillRef.current) fillRef.current.style.width = `${value}%`;
      setPct(Math.round(value));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [done, reducedMotion]);

  useEffect(() => {
    if (done) return;
    const id = setInterval(
      () => setMessageIndex((i) => Math.min(i + 1, LOADING_MESSAGES.length - 1)),
      MESSAGE_EVERY_MS,
    );
    return () => clearInterval(id);
  }, [done]);

  // Reduced motion: step the bar once per stage instead of animating each frame.
  useEffect(() => {
    if (!reducedMotion || done) return;
    const value = ((messageIndex + 1) / LOADING_MESSAGES.length) * CLIMB_TARGET;
    if (fillRef.current) fillRef.current.style.width = `${value}%`;
    setPct(Math.round(value));
  }, [reducedMotion, done, messageIndex]);

  // Landed — close the bar out from wherever the climb reached.
  useEffect(() => {
    if (!done) return;
    if (fillRef.current) {
      // Literal rather than var(--ease-out) so a CSSOM quirk can't silently
      // drop the transition and make this snap.
      fillRef.current.style.transition = 'width 300ms cubic-bezier(0.16, 1, 0.3, 1)';
      fillRef.current.style.width = '100%';
    }
    setPct(100);
  }, [done]);

  return (
    <div className="estimate-loading">
      <span className="feature-icon"><BoltIcon size={24} /></span>

      <div>
        <p className="loading-headline" aria-live="polite">
          {done ? 'Done!' : LOADING_MESSAGES[messageIndex]}
        </p>
        <p className="loading-sub">{done ? '' : 'This usually takes under a minute.'}</p>
      </div>

      <div
        className="progress-track"
        role="progressbar"
        aria-label="Estimate progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="progress-fill" ref={fillRef} />
      </div>
      <p className="progress-pct">{pct}%</p>
    </div>
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
