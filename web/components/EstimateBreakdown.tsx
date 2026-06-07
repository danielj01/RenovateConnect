import { type EstimateResult, money } from '@/lib/estimate';

// Presentational only (no hooks) so it works in both server and client trees.
export function EstimateBreakdown({ result }: { result: EstimateResult }) {
  const currency = result.currency || 'USD';
  return (
    <>
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
          <div
            key={i}
            style={{
              display: 'flex', justifyContent: 'space-between', padding: '12px 16px',
              borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            }}
          >
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
    </>
  );
}
