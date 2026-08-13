import { type EstimateResult, money } from '@/lib/estimate';

// Presentational only (no hooks) so it works in both server and client trees.
export function EstimateBreakdown({ result }: { result: EstimateResult }) {
  const currency = result.currency || 'USD';
  const items = result.lineItems ?? [];

  return (
    <>
      <div
        className="card center"
        style={{ background: 'var(--blue-tint)', border: 'none', padding: '28px 24px' }}
      >
        <div
          className="muted"
          style={{ fontSize: '0.8125rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}
        >
          Estimated cost range
        </div>
        <div
          className="tabular"
          style={{
            fontSize: 'clamp(1.875rem, 1.4rem + 2vw, 2.5rem)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
            margin: '8px 0',
          }}
        >
          {money(result.totalLow, currency)} – {money(result.totalHigh, currency)}
        </div>
        {result.confidence ? (
          <span className="badge">Confidence: {result.confidence}</span>
        ) : null}
      </div>

      {result.summary ? <p className="muted mt-6">{result.summary}</p> : null}

      {items.length > 0 ? (
        <>
          <h2 style={{ fontSize: '1.25rem', marginTop: 28, marginBottom: 12 }}>Itemized breakdown</h2>
          <div className="card card-flush">
            {items.map((li, i) => (
              <div
                key={`${li.item}-${i}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 16,
                  padding: '14px 18px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--separator)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{li.item}</div>
                  {li.unit ? (
                    <div className="muted" style={{ fontSize: '0.8125rem' }}>{li.unit}</div>
                  ) : null}
                </div>
                <div className="tabular" style={{ whiteSpace: 'nowrap', fontSize: '0.9375rem' }}>
                  {money(li.low, currency)} – {money(li.high, currency)}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {result.notes ? (
        <p className="muted" style={{ fontSize: '0.875rem', marginTop: 16 }}>{result.notes}</p>
      ) : null}
    </>
  );
}
