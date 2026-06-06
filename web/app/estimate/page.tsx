'use client';

import { useEffect, useState } from 'react';
import { appStoreUrl } from '@/lib/config';

interface LineItem { item: string; low: number; high: number; unit?: string }
interface EstimateResult {
  summary: string;
  lineItems: LineItem[];
  totalLow: number;
  totalHigh: number;
  currency?: string;
  confidence?: string;
  notes?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const ROOM_TYPES = ['Kitchen', 'Bathroom', 'Bedroom', 'Living room', 'Whole home', 'Exterior', 'Other'];

function money(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

export default function EstimatePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [roomType, setRoomType] = useState(ROOM_TYPES[0]);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefill the room from ?room= (the SEO cost pages link in pre-filled). Read
  // on mount via window so the page stays statically rendered.
  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get('room');
    if (room && ROOM_TYPES.includes(room)) setRoomType(room);
  }, []);

  const previews = files.map((f) => URL.createObjectURL(f));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) { setError('Add at least one photo.'); return; }
    setStatus('loading');
    setError(null);
    try {
      const form = new FormData();
      files.slice(0, 5).forEach((f) => form.append('images', f));
      form.append('roomType', roomType);
      if (description) form.append('description', description);

      const res = await fetch(`${API_BASE}/estimations/guest`, { method: 'POST', body: form });
      if (res.status === 429) {
        setStatus('error');
        setError('You’ve hit the free estimate limit for now. Get the app to keep going.');
        return;
      }
      if (!res.ok) throw new Error(`Estimate failed (${res.status})`);
      const data = await res.json();
      setResult(data.result as EstimateResult);
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  function reset() {
    setFiles([]); setResult(null); setError(null); setStatus('idle'); setDescription('');
  }

  if (status === 'done' && result) {
    return <ResultView result={result} onReset={reset} />;
  }

  return (
    <main className="container">
      <h1 style={{ fontSize: 28, margin: '8px 0 6px' }}>Get your instant estimate</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Add a photo of your space and we’ll return an itemized cost range in seconds. Free, no account needed.
      </p>

      <form onSubmit={submit} style={{ marginTop: 20 }}>
        <label className="card" style={{ display: 'block', cursor: 'pointer', textAlign: 'center', borderStyle: 'dashed' }}>
          <input
            type="file"
            accept="image/*"
            multiple
            // `capture` hints the rear camera on mobile browsers.
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 5))}
          />
          {files.length === 0 ? (
            <span className="muted">📷 Tap to add up to 5 photos</span>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {previews.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt={`Photo ${i + 1}`} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10 }} />
              ))}
            </div>
          )}
        </label>

        <div style={{ marginTop: 16 }}>
          <label className="muted" style={{ fontSize: 14 }}>Room / project</label>
          <select
            value={roomType}
            onChange={(e) => setRoomType(e.target.value)}
            style={{ width: '100%', height: 48, borderRadius: 12, border: '1px solid var(--border)', padding: '0 12px', marginTop: 6, fontSize: 16 }}
          >
            {ROOM_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div style={{ marginTop: 16 }}>
          <label className="muted" style={{ fontSize: 14 }}>Anything specific? (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. replace cabinets and countertops, keep the layout"
            rows={3}
            style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border)', padding: 12, marginTop: 6, fontSize: 16, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </div>

        {error ? <p style={{ color: '#b91c1c', marginTop: 14 }}>{error}</p> : null}

        <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: 18 }} disabled={status === 'loading'}>
          {status === 'loading' ? 'Analyzing your photos…' : 'Get my estimate'}
        </button>
        <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 10 }}>
          Estimates are AI-generated ranges to help you plan — not a quote.
        </p>
      </form>
    </main>
  );
}

function ResultView({ result, onReset }: { result: EstimateResult; onReset: () => void }) {
  const currency = result.currency || 'USD';
  return (
    <main className="container">
      <div className="card" style={{ textAlign: 'center', background: 'var(--primary-light)', border: 'none' }}>
        <div className="muted" style={{ fontSize: 14 }}>Estimated cost range</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--primary)', margin: '4px 0' }}>
          {money(result.totalLow, currency)} – {money(result.totalHigh, currency)}
        </div>
        {result.confidence ? <span className="badge">Confidence: {result.confidence}</span> : null}
      </div>

      {result.summary ? <p style={{ marginTop: 18 }}>{result.summary}</p> : null}

      <h2 style={{ fontSize: 20, marginTop: 22 }}>Itemized breakdown</h2>
      <div className="card" style={{ padding: 0 }}>
        {result.lineItems?.map((li, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{li.item}</div>
              {li.unit ? <div className="muted" style={{ fontSize: 13 }}>{li.unit}</div> : null}
            </div>
            <div style={{ whiteSpace: 'nowrap' }}>{money(li.low, currency)} – {money(li.high, currency)}</div>
          </div>
        ))}
      </div>

      {result.notes ? (
        <p className="muted" style={{ fontSize: 14, marginTop: 14 }}>{result.notes}</p>
      ) : null}

      {/* Conversion gate — the whole point of the front door. */}
      <section className="card" style={{ marginTop: 26, textAlign: 'center', background: 'var(--bg-soft)' }}>
        <strong style={{ fontSize: 18 }}>Make it real</strong>
        <p className="muted" style={{ marginTop: 6 }}>
          Save this estimate and get matched with vetted local contractors — with payment protection and no spam.
        </p>
        <a className="btn btn-primary btn-block" href={appStoreUrl} style={{ marginTop: 8 }}>
          Save & get matched in the app
        </a>
      </section>

      <button onClick={onReset} className="btn btn-secondary btn-block" style={{ marginTop: 12 }}>
        Estimate another space
      </button>
    </main>
  );
}
