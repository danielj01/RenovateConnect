'use client';

import { useId, useState } from 'react';
import { CheckCircleIcon } from '@/components/Icons';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

type Props = {
  /** Where this signup came from, stored for segmentation (e.g. "estimate"). */
  source: string;
  /** Optional free-text context, e.g. the room they estimated. */
  context?: string;
  /** HOMEOWNER (default) or CONTRACTOR. */
  role?: 'HOMEOWNER' | 'CONTRACTOR';
  /** Headline + subcopy shown above the field. Pass null to render form-only. */
  title?: string | null;
  subtitle?: string | null;
  /** Submit button label. */
  cta?: string;
  /** Show the optional city field — worth it on the landing page, noise inline. */
  askCity?: boolean;
  /** Placeholder for the city field. */
  cityPlaceholder?: string;
  /** Render without the surrounding card (when the parent already is one). */
  bare?: boolean;
};

export function WaitlistForm({
  source,
  context,
  role = 'HOMEOWNER',
  title = 'Get notified when we launch near you',
  subtitle = 'Drop your email and we’ll let you know the moment RenovateConnect goes live in your area. No spam.',
  cta = 'Notify me at launch',
  askCity = false,
  cityPlaceholder = 'San Francisco',
  bare = false,
}: Props) {
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          role,
          source,
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(context ? { context } : {}),
        }),
      });
      if (res.status === 429) {
        setStatus('error');
        setError('Too many sign-ups from this device right now — try again a little later.');
        return;
      }
      if (!res.ok) throw new Error('signup failed');
      setStatus('done');
    } catch {
      setStatus('error');
      setError('Couldn’t sign you up right now. Please try again in a moment.');
    }
  }

  // NOTE: this used to be a `Wrapper` component declared here in the render.
  // That gives it a brand-new component identity on every keystroke, so React
  // unmounted and remounted the whole subtree — including the focused input —
  // and typing appeared to "stop after every letter". Never declare a component
  // inside another component's body; vary the className instead.
  const wrapperClass = bare ? undefined : 'card';

  if (status === 'done') {
    return (
      <div className={wrapperClass}>
        <div className="center">
          <div className="feature-icon icon-green" style={{ margin: '0 auto 14px' }}>
            <CheckCircleIcon size={22} />
          </div>
          <h3 style={{ marginBottom: 6 }}>You&rsquo;re on the list</h3>
          <p className="muted" style={{ fontSize: '0.9375rem', margin: 0 }}>
            We&rsquo;ll email <strong style={{ color: 'var(--label)' }}>{email.trim()}</strong>{' '}
            {role === 'CONTRACTOR'
              ? 'to get your founding profile set up before launch.'
              : 'the moment we go live near you.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      {title ? <h3 style={{ marginBottom: subtitle ? 6 : 16 }}>{title}</h3> : null}
      {subtitle ? (
        <p className="muted" style={{ fontSize: '0.9375rem', marginBottom: 18 }}>{subtitle}</p>
      ) : null}

      <form onSubmit={submit} noValidate={false}>
        <label className="field" htmlFor={`${id}-email`}>
          <span>Email address</span>
          <input
            id={`${id}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {askCity ? (
          <label className="field" htmlFor={`${id}-city`}>
            <span>City <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></span>
            <input
              id={`${id}-city`}
              type="text"
              autoComplete="address-level2"
              placeholder={cityPlaceholder}
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </label>
        ) : null}

        <button type="submit" className="btn btn-primary btn-block mt-4" disabled={status === 'loading'}>
          {status === 'loading' ? 'Signing you up…' : cta}
        </button>
      </form>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      <p className="form-note">
        One email at launch. No spam, and we never sell your address.
      </p>
    </div>
  );
}
