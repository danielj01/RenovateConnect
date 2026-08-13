import type { Metadata, Viewport } from 'next';
import './globals.css';
import { siteName, tagline, appleAppStoreId } from '@/lib/config';

export const metadata: Metadata = {
  title: { default: `${siteName} — ${tagline}`, template: `%s · ${siteName}` },
  description:
    'Get an instant AI renovation estimate from a photo, then connect directly with a licensed Bay Area contractor — no spam, no lead-selling, no middleman holding your money.',
  metadataBase: new URL('https://renovateconnect.com'),
  openGraph: {
    type: 'website',
    siteName,
    title: `${siteName} — ${tagline}`,
    description:
      'Know what your renovation costs before you call anyone, then connect directly with a licensed Bay Area contractor.',
    url: 'https://renovateconnect.com',
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
    <span className="brand-mark" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11.2 12 4l9 7.2" />
        <path d="M5.5 9.8V20h13V9.8" />
      </svg>
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
