'use client';

// The pre-launch landing page. Two audiences want opposite things from this
// page — a homeowner wants to know it's free and spam-free, a contractor wants
// to know what it costs and whether leads get resold — so rather than stacking
// two forms and making everyone read both, a segmented control swaps the whole
// panel. The choice is also the signup's `role`, so what someone reads is what
// we record.

import { useEffect, useState } from 'react';
import { WaitlistForm } from '@/components/WaitlistForm';
import { CheckCircleIcon, ArrowRightIcon, InfoIcon } from '@/components/Icons';

type Audience = 'HOMEOWNER' | 'CONTRACTOR';

const PANELS: Record<Audience, {
  tab: string;
  heading: string;
  body: string;
  image: { src: string; srcSet?: string; alt: string; w: number; h: number };
  points: { title: string; body: string }[];
  form: { title: string; subtitle: string; cta: string; cityPlaceholder: string };
}> = {
  HOMEOWNER: {
    tab: 'I’m a homeowner',
    heading: 'Be first in line when we open in your city',
    body:
      'RenovateConnect gives you an itemized cost range from a photo, then puts you in touch with licensed Bay Area contractors — directly, with no lead broker in between.',
    image: {
      src: '/img/living.jpg',
      alt: 'A bright, modern living room',
      w: 1000,
      h: 677,
    },
    points: [
      {
        title: 'Free, always, for homeowners',
        body: 'No fee to estimate, browse, or message. Contractors pay a flat listing subscription; you pay nothing.',
      },
      {
        title: 'Your number never gets sold',
        body: 'We don’t run a lead business. Nobody buys your details, so nobody calls you six times an hour.',
      },
      {
        title: 'You pay the contractor directly',
        body: 'No escrow, no deposit through us, no cut of your project. The contract is between you and the licensed pro.',
      },
      {
        title: 'Licensed, admin-reviewed pros',
        body: 'Every listing shows a CSLB license number, and a human reviews each profile before it goes live.',
      },
    ],
    form: {
      title: 'Get notified at launch',
      subtitle: 'One email when we go live in your area. That’s the whole deal.',
      cta: 'Notify me at launch',
      cityPlaceholder: 'San Francisco',
    },
  },
  CONTRACTOR: {
    tab: 'I’m a contractor',
    heading: 'Claim a founding spot before we open the doors',
    body:
      'Founding contractors get set up by hand, listed from day one, and keep 100% of every job. One flat subscription — no per-lead fees, no commission, ever.',
    image: {
      src: '/img/crew.jpg',
      srcSet: '/img/crew-700.jpg 700w, /img/crew.jpg 1400w',
      alt: 'Two tradespeople installing flooring in a house under renovation',
      w: 1400,
      h: 931,
    },
    points: [
      {
        title: '$10/month, first month free',
        body: 'A flat listing subscription starting after your profile is approved. That’s the entire cost of being on the platform.',
      },
      {
        title: 'No lead fees. No commission.',
        body: 'You’re never charged per enquiry, and we take no percentage of the work you win. Homeowners message you directly.',
      },
      {
        title: 'Ranking you can’t buy',
        body: 'Search order comes from verification and ratings. Paid promotion exists only as a clearly labelled “Boosted” slot above the organic list.',
      },
      {
        title: 'Free CRM for your pipeline',
        body: 'Every conversation becomes a lead you can track from new to won, plus quotes, photos, and a public portfolio.',
      },
    ],
    form: {
      title: 'Claim your founding spot',
      subtitle: 'We’ll reach out personally to get your profile and license details set up.',
      cta: 'Keep me posted',
      cityPlaceholder: 'Oakland',
    },
  },
};

export function WaitlistLanding() {
  const [audience, setAudience] = useState<Audience>('HOMEOWNER');

  // `?for=contractor` deep-links straight to the contractor panel — the footer
  // and home page both point here. Read on mount so the page stays static.
  useEffect(() => {
    const forParam = new URLSearchParams(window.location.search).get('for');
    if (forParam === 'contractor' || forParam === 'business') setAudience('CONTRACTOR');
  }, []);

  const panel = PANELS[audience];

  return (
    <>
      <section className="hero">
        <div className="container" style={{ display: 'block', textAlign: 'center' }}>
          <span className="badge">Launching in the Bay Area</span>
          <h1 style={{ margin: '16px auto 16px', maxWidth: '18ch' }}>
            We&rsquo;re opening soon. Get in early.
          </h1>
          <p className="lede" style={{ maxWidth: '52ch', margin: '0 auto 32px' }}>
            RenovateConnect connects Bay Area homeowners with licensed contractors —
            instant AI estimates, no lead-selling, and no middleman holding anyone&rsquo;s
            money.
          </p>

          <div
            className="segmented"
            role="tablist"
            aria-label="Who are you signing up as?"
          >
            {(Object.keys(PANELS) as Audience[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-selected={audience === key}
                aria-controls={`panel-${key}`}
                onClick={() => setAudience(key)}
              >
                {PANELS[key].tab}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 'clamp(40px, 6vw, 72px)' }}>
        <div
          className="split"
          role="tabpanel"
          id={`panel-${audience}`}
          aria-labelledby={`tab-${audience}`}
          key={audience}
        >
          <div className="split-copy rise">
            <h2>{panel.heading}</h2>
            <p>{panel.body}</p>
            <ul className="check-list">
              {panel.points.map((p) => (
                <li key={p.title}>
                  <CheckCircleIcon />
                  <span>
                    <strong>{p.title}.</strong> {p.body}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rise rise-2">
            <WaitlistForm
              source="waitlist_page"
              role={audience}
              title={panel.form.title}
              subtitle={panel.form.subtitle}
              cta={panel.form.cta}
              cityPlaceholder={panel.form.cityPlaceholder}
              askCity
            />

            <div className="split-media mt-6" style={{ aspectRatio: '16 / 9' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={panel.image.src}
                srcSet={panel.image.srcSet}
                sizes="(max-width: 860px) 92vw, 46vw"
                width={panel.image.w}
                height={panel.image.h}
                alt={panel.image.alt}
                loading="lazy"
                decoding="async"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">What happens after you sign up</h2>
        <p className="section-subtitle">
          No drip campaign, no &ldquo;quick call&rdquo; from a sales rep.
        </p>

        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <h3>A confirmation email</h3>
            <p>One message so you know it landed, with what to expect and nothing to click.</p>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <h3>Then silence</h3>
            <p>
              {audience === 'CONTRACTOR'
                ? 'Until we’re ready to onboard founding contractors in your city.'
                : 'Until we actually have licensed contractors live in your area.'}
            </p>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <h3>Your launch invite</h3>
            <p>
              {audience === 'CONTRACTOR'
                ? 'We reach out personally to verify your license and build your profile with you.'
                : 'An invite to browse pros and get real quotes for the project you have in mind.'}
            </p>
          </div>
        </div>

        <div className="notice mt-8" style={{ maxWidth: '60ch', marginInline: 'auto' }}>
          <InfoIcon />
          <span>
            <strong>Want a number right now?</strong> The estimator is already live and
            free — you don&rsquo;t need to wait for launch or make an account.{' '}
            <a href="/estimate" style={{ color: 'var(--blue-text)', fontWeight: 600 }}>
              Try it <ArrowRightIcon size={14} />
            </a>
          </span>
        </div>
      </section>
    </>
  );
}
