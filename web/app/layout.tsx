import type { Metadata, Viewport } from 'next';
import './globals.css';
import { siteName, tagline, appleAppStoreId } from '@/lib/config';
import { BrandLogo } from '@/components/BrandLogo';

// Canonical host. The apex 308-redirects to www, so www is the real address —
// pointing canonicals, OG urls, and the sitemap at the apex would make every
// one of them a redirect hop for crawlers.
const SITE_URL = 'https://www.renovateconnect.com';

export const metadata: Metadata = {
  // The full tagline runs to 69 characters once the brand is prepended, and
  // Google cuts titles around 60. This leads with brand + primary keyword +
  // geography instead; the tagline still carries the brand voice on social,
  // where length isn't clipped.
  title: {
    default: `${siteName} — Bay Area Renovation Cost Estimates`,
    template: `%s · ${siteName}`,
  },
  // Descriptions are kept under ~155 characters — past that Google truncates
  // mid-sentence and the snippet reads as broken.
  description:
    'Get a free AI renovation estimate from one photo, then connect directly with a licensed Bay Area contractor. No spam and no lead-selling.',
  metadataBase: new URL(SITE_URL),
  // Every page sets its own canonical; this is the fallback for any that don't,
  // and it stops query-string variants (?for=contractor, utm_*) being indexed
  // as separate pages.
  alternates: { canonical: '/' },
  applicationName: siteName,
  keywords: [
    'renovation cost estimate',
    'home renovation Bay Area',
    'kitchen remodel cost San Francisco',
    'bathroom remodel cost',
    'licensed contractors Bay Area',
    'AI renovation estimate',
  ],
  authors: [{ name: siteName, url: SITE_URL }],
  creator: siteName,
  publisher: siteName,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    siteName,
    locale: 'en_US',
    title: `${siteName} — ${tagline}`,
    description:
      'Know what your renovation costs before you call anyone, then connect directly with a licensed Bay Area contractor.',
    url: SITE_URL,
    images: [{ url: '/img/kitchen.jpg', width: 1600, height: 1000, alt: 'A renovated kitchen' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteName} — ${tagline}`,
    description: 'Instant AI renovation estimates. Licensed Bay Area contractors. No lead-selling.',
    images: ['/img/kitchen.jpg'],
  },
  ...(appleAppStoreId ? { appleWebApp: { capable: true } } : {}),
};

// Organization + WebSite structured data. This is what lets Google show a real
// site name and logo next to the result instead of guessing — worth having
// given the domain's stale parking-page entry needs replacing.
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: siteName,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon.svg`, width: 100, height: 100 },
      description:
        'A referral marketplace connecting Bay Area homeowners with licensed renovation contractors, with free AI cost estimates from a photo.',
      email: 'support@renovateconnect.com',
      areaServed: {
        '@type': 'AdministrativeArea',
        name: 'San Francisco Bay Area, California',
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: siteName,
      description: tagline,
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'en-US',
    },
  ],
};

// `viewport-fit=cover` lets the safe-area insets in globals.css do their job on
// notched iPhones; the theme color keeps Safari's chrome in step with the page
// in both appearances.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

function BrandMark() {
  return (
    <span className="brand-mark">
      <BrandLogo size={26} />
    </span>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <html lang="en">
      <head>
        {appleAppStoreId ? (
          <meta name="apple-itunes-app" content={`app-id=${appleAppStoreId}`} />
        ) : null}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>

        <header className="site-header">
          <div className="container">
            <a href="/" className="brand" aria-label={`${siteName} home`}>
              <BrandMark />
              {siteName}
            </a>
            <nav className="nav-links" aria-label="Primary">
              <a href="/estimate">Estimate</a>
              <a href="/cost" className="nav-hide-sm">Cost guides</a>
              <a href="/waitlist" className="nav-cta">Join waitlist</a>
            </nav>
          </div>
        </header>

        <div id="main">{children}</div>

        <footer className="site-footer">
          <div className="container">
            <div className="footer-grid">
              <div className="footer-about">
                <a href="/" className="brand" style={{ marginBottom: 12 }}>
                  <BrandMark />
                  {siteName}
                </a>
                <p style={{ maxWidth: '34ch', fontSize: '0.9375rem' }}>
                  Instant AI renovation estimates and licensed Bay Area contractors.
                  You hire and pay the contractor directly — we never hold your money
                  and never sell your number.
                </p>
              </div>

              <div>
                <p className="footer-heading">Product</p>
                <ul className="footer-list">
                  <li><a href="/estimate">Get an estimate</a></li>
                  <li><a href="/cost">Cost guides</a></li>
                  <li><a href="/waitlist">Join the waitlist</a></li>
                  <li><a href="/waitlist?for=contractor">For contractors</a></li>
                </ul>
              </div>

              <div>
                <p className="footer-heading">Company</p>
                <ul className="footer-list">
                  <li><a href="/privacy">Privacy Policy</a></li>
                  <li><a href="/terms">Terms of Service</a></li>
                  <li><a href="mailto:support@renovateconnect.com">support@renovateconnect.com</a></li>
                </ul>
              </div>
            </div>

            <div className="footer-legal">
              <span>© {year} {siteName}</span>
              <span>Serving the San Francisco Bay Area</span>
              <span>Estimates are AI-generated planning ranges, not quotes.</span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
