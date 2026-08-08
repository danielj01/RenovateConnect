import type { Metadata } from 'next';
import { Lexend, Source_Sans_3 } from 'next/font/google';
import './globals.css';
import { siteName, tagline, appleAppStoreId } from '@/lib/config';

const lexend = Lexend({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-lexend',
  display: 'swap',
});
const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-source-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: `${siteName} — ${tagline}`, template: `%s · ${siteName}` },
  description:
    'Get an instant AI renovation estimate from a photo, then connect directly with a vetted Bay Area contractor — no spam, no lead-selling.',
  metadataBase: new URL('https://renovateconnect.com'),
  // Smart App Banner so iOS Safari offers to open/install the app.
  ...(appleAppStoreId
    ? { appleWebApp: { capable: true } }
    : {}),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lexend.variable} ${sourceSans.variable}`}>
      <head>
        {appleAppStoreId ? (
          <meta name="apple-itunes-app" content={`app-id=${appleAppStoreId}`} />
        ) : null}
      </head>
      <body>
        <header className="site-header">
          <div className="container">
            <a href="/" className="brand">RenovateConnect</a>
            <nav className="nav-links">
              <a href="/estimate">Get an estimate</a>
              <a href="/cost">Cost guides</a>
              <a href="/waitlist">Waitlist</a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer container muted" style={{ fontSize: 14, paddingTop: 32 }}>
          <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a>
          {' '}· © {new Date().getFullYear()} {siteName}
        </footer>
      </body>
    </html>
  );
}
