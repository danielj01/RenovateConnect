// Home. The job of this page is to make one number feel reachable — what will
// this cost? — and then hand the visitor to either the estimator or the
// waitlist. Everything claimed here has to stay true of the post-2026-06-26
// referral model: no platform-held money, no lead-selling, no escrow.

import { categories, metroBySlug, scaledCost, money } from '@/lib/costData';
import {
  CameraIcon, ShieldIcon, CheckIcon, CheckCircleIcon,
  ArrowRightIcon, LockIcon, ToolIcon, BoltIcon,
} from '@/components/Icons';

// Tiles quote San Francisco because it's the metro anchor for launch; each one
// links to the real cost guide so the number on the tile is the same number the
// guide computes (both come from scaledCost — no hand-typed ranges to drift).
const SF = metroBySlug('san-francisco')!;

const TILES: { slug: string; img: string; label: string }[] = [
  { slug: 'kitchen', img: '/img/kitchen-800.jpg', label: 'Kitchen' },
  { slug: 'bathroom', img: '/img/bathroom.jpg', label: 'Bathroom' },
  { slug: 'living-room', img: '/img/living.jpg', label: 'Living room' },
  { slug: 'bedroom', img: '/img/bedroom.jpg', label: 'Bedroom' },
  { slug: 'whole-home', img: '/img/wholehome.jpg', label: 'Whole home' },
  { slug: 'exterior', img: '/img/exterior.jpg', label: 'Exterior' },
];

const STEPS = [
  {
    title: 'Snap a photo',
    body: 'Point your camera at the room. No measurements, no forms, no account — one photo is enough to start.',
  },
  {
    title: 'Get an itemized range',
    body: 'Claude reads the space and returns a line-by-line cost range in seconds: cabinets, tile, labor, the lot.',
  },
  {
    title: 'Talk to a licensed pro',
    body: 'Browse licensed Bay Area contractors, message the ones you like, and hire whoever you choose. Directly.',
  },
];

const FEATURES = [
  {
    icon: <CameraIcon />,
    tone: '',
    title: 'A number before the sales call',
    body: 'Walk into your first conversation already knowing the range. Nobody gets to anchor you.',
  },
  {
    icon: <ShieldIcon />,
    tone: 'icon-green',
    title: 'Licensed and admin-reviewed',
    body: 'Every contractor lists a CSLB license number, and a human reviews the profile before it goes live.',
  },
  {
    icon: <LockIcon />,
    tone: 'icon-amber',
    title: 'Your number is yours',
    body: 'We never sell or resell your contact details. No lead brokers, no five callbacks in an hour.',
  },
];

function tileRange(slug: string) {
  const category = categories.find((c) => c.slug === slug);
  if (!category) return null;
  const { totalLow, totalHigh } = scaledCost(category, SF);
  return `${money(totalLow)}–${money(totalHigh)}`;
}

export default function Home() {
  return (
    <>
      {/* ---- Hero ---- */}
      <section className="hero">
        <div className="container">
          <div className="hero-copy rise">
            <span className="badge">
              <BoltIcon size={14} />
              Bay Area · Free for homeowners
            </span>
            <h1>Know what it costs before you call anyone.</h1>
            <p className="lede">
              Snap one photo of the space. Get an itemized renovation estimate in
              seconds — then connect directly with a licensed Bay Area contractor.
            </p>

            <div className="btn-row mt-6">
              <a className="btn btn-primary" href="/estimate">
                Get an instant estimate
                <ArrowRightIcon size={17} />
              </a>
              <a className="btn btn-ghost" href="/waitlist">Join the waitlist</a>
            </div>

            <div className="trust-row">
              <span className="trust-item"><CheckIcon />Free for homeowners</span>
              <span className="trust-item"><CheckIcon />No lead-selling</span>
              <span className="trust-item"><CheckIcon />No account needed</span>
            </div>
          </div>

          <div className="hero-media rise rise-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/kitchen.jpg"
              srcSet="/img/kitchen-800.jpg 800w, /img/kitchen.jpg 1600w"
              sizes="(max-width: 860px) 92vw, 46vw"
              width={1600}
              height={1000}
              alt="A renovated kitchen with a wood-panelled island and stools"
              fetchPriority="high"
            />
            <div className="hero-quote">
              <div className="muted" style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Kitchen · San Francisco
              </div>
              <div className="amount">{tileRange('kitchen')}</div>
              <div className="muted" style={{ fontSize: '0.8125rem' }}>Typical full remodel range</div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section className="section">
        <span className="eyebrow">How it works</span>
        <h2 className="section-title">Three steps, no phone tag</h2>
        <p className="section-subtitle">
          The estimate is free and instant. The contractor conversation happens on
          your terms, when you&rsquo;re ready for it.
        </p>

        <div className="steps">
          {STEPS.map((s, i) => (
            <div className="step" key={s.title}>
              <div className="step-num">{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Cost tiles ---- */}
      <section className="section">
        <span className="eyebrow">Bay Area cost guides</span>
        <h2 className="section-title">What renovations actually cost here</h2>
        <p className="section-subtitle">
          Typical San Francisco ranges for a full project. Tap through for the
          line-by-line breakdown, or price your own space in a photo.
        </p>

        <div className="tile-grid">
          {TILES.map((t) => (
            <a className="tile" key={t.slug} href={`/cost/san-francisco/${t.slug}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.img} width={800} height={533} alt="" loading="lazy" decoding="async" />
              <span className="tile-label">
                <strong>{t.label}</strong>
                <span>{tileRange(t.slug)}</span>
              </span>
            </a>
          ))}
        </div>

        <p className="center mt-8">
          <a className="btn btn-secondary" href="/cost">
            All cities and cost guides
            <ArrowRightIcon size={17} />
          </a>
        </p>
      </section>

      {/* ---- Why ---- */}
      <section className="section">
        <span className="eyebrow">Why RenovateConnect</span>
        <h2 className="section-title">Built to be the opposite of a lead broker</h2>
        <p className="section-subtitle">
          Homeowners get real numbers fast. Good contractors get real conversations
          — not a contact record sold to four of their competitors.
        </p>

        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <div className={`feature-icon ${f.tone}`}>{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Trust split ---- */}
      <section className="section">
        <div className="split">
          <div className="split-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/craft.jpg"
              srcSet="/img/craft-700.jpg 700w, /img/craft.jpg 1400w"
              sizes="(max-width: 860px) 92vw, 46vw"
              width={1400}
              height={787}
              alt="A carpenter smoothing a board with a hand plane"
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="split-copy">
            <h2>You hire the contractor. Not us.</h2>
            <p>
              RenovateConnect is a referral platform, full stop. We introduce you to
              licensed pros and then get out of the way — the contract and the
              payments are between you and them, exactly as California expects.
            </p>
            <ul className="check-list">
              <li>
                <CheckCircleIcon />
                <span><strong>No platform holding your money.</strong> There&rsquo;s no escrow, no deposit through us, no cut of your project.</span>
              </li>
              <li>
                <CheckCircleIcon />
                <span><strong>License numbers shown up front.</strong> Every listing carries a CSLB number you can verify yourself.</span>
              </li>
              <li>
                <CheckCircleIcon />
                <span><strong>Placement isn&rsquo;t for sale.</strong> Search order comes from verification and ratings; paid promotion only appears in a labelled &ldquo;Boosted&rdquo; slot.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ---- Contractors split ---- */}
      <section className="section">
        <div className="split split-reverse">
          <div className="split-copy">
            <span className="badge badge-neutral"><ToolIcon size={14} />For contractors</span>
            <h2 className="mt-4">Real conversations, not resold leads</h2>
            <p>
              One flat listing subscription. No per-lead fees, ever. Homeowners
              message you directly, and every project they book is yours — we take
              no percentage of the work.
            </p>
            <ul className="check-list">
              <li><CheckCircleIcon /><span><strong>$10/month to be listed</strong>, with your first month free after approval.</span></li>
              <li><CheckCircleIcon /><span><strong>Zero commission</strong> on the jobs you win.</span></li>
              <li><CheckCircleIcon /><span><strong>Founding contractors</strong> get set up by hand before launch.</span></li>
            </ul>
            <div className="btn-row mt-6">
              <a className="btn btn-primary" href="/waitlist?for=contractor">
                Claim a founding spot
                <ArrowRightIcon size={17} />
              </a>
            </div>
          </div>
          <div className="split-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/crew.jpg"
              srcSet="/img/crew-700.jpg 700w, /img/crew.jpg 1400w"
              sizes="(max-width: 860px) 92vw, 46vw"
              width={1400}
              height={931}
              alt="Two tradespeople installing flooring in a house under renovation"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </section>

      {/* ---- Closing CTA ---- */}
      <section className="cta-band">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="cta-bg" src="/img/exterior.jpg" width={1000} height={666} alt="" loading="lazy" decoding="async" />
        <h2>Price your project in about a minute</h2>
        <p>
          Free, instant, and no account required. If we haven&rsquo;t launched in your
          part of the Bay yet, we&rsquo;ll save your spot.
        </p>
        <div className="btn-row">
          <a className="btn btn-on-dark" href="/estimate">
            Get an instant estimate
            <ArrowRightIcon size={17} />
          </a>
          <a className="btn btn-ghost" href="/waitlist" style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>
            Join the waitlist
          </a>
        </div>
      </section>
    </>
  );
}
