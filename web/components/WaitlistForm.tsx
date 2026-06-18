'use client';

import { useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

type Props = {
  /** Where this signup came from, stored for segmentation (e.g. "estimate"). */
  source: string;
  /** Optional free-text context, e.g. the room they estimated. */
  context?: string;
  /** HOMEOWNER (default) or CONTRACTOR. */
  role?: 'HOMEOWNER' | 'CONTRACTOR';
  /** Headline + subcopy shown above the field. */
  title?: string;
  subtitle?: string;
  /** Submit button label. */
  cta?: string;
};

export function WaitlistForm({
  source,
  context,
  role = 'HOMEOWNER',
  title = 'Get notified when we launch near you',
  subtitle = 'Drop your email and we’ll let you know the moment RenovateConnect goes live in your area. No spam.',
  cta = 'Notify me at launch',
}: Props) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role, source, context }),
      });
      if (res.status === 429) {
        setStatus('error');
        setError('Too many sign-ups from this device right now — try again later.');
        return;
      }
      if (!res.ok) throw new Error('signup failed');
      setStatus('done');
    } catch {
      setStatus('error');
      setError('Couldn’t sign you up right now. Please try again.');
    }
  }

  if (status === 'done') {
    return (
      <section className="card" style={{ textAlign: 'center', background: 'var(--bg-soft)' }}>
        <strong style={{ fontSize: 18 }}>You’re on the list 🎉</strong>
        <p className="muted" style={{ marginTop: 6 }}>
          We’ll email <strong>{email.trim()}</strong> the moment we launch near you.
        </p>
      </section>
    );
  }

  return (
    <section className="card" style={{ background: 'var(--bg-soft)' }}>
      <strong style={{ fontSize: 18 }}>{title}</strong>
      <p className="muted" style={{ marginTop: 6, marginBottom: 14 }}>{subtitle}</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ height: 48, borderRadius: 12, border: '1px solid var(--border)', padding: '0 14px', fontSize: 16 }}
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={status === 'loading'}>
          {status === 'loading' ? 'Signing you up…' : cta}
        </button>
      </form>
      {error ? <p style={{ color: '#b91c1c', marginTop: 10, marginBottom: 0 }}>{error}</p> : null}
    </section>
  );
}
