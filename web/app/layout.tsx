import type { Metadata } from 'next';
import './globals.css';
import { siteName, tagline, appleAppStoreId } from '@/lib/config';

export const metadata: Metadata = {
  title: { default: `${siteName} — ${tagline}`, template: `%s · ${siteName}` },
  description:
    'Get an instant AI renovation estimate from a photo, then hire a vetted Bay Area contractor with payment protection — no spam, no lead-selling.',
  metadataBase: new URL('https://renovateconnect.app'),
  // Smart App Banner so iOS Safari offers to open/install the app.
  ...(appleAppStoreId
    ? { appleWebApp: { capable: true } }
    : {}),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {appleAppStoreId ? (
          <meta name="apple-itunes-app" content={`app-id=${appleAppStoreId}`} />
        ) : null}
      </head>
      <body>
        <header className="site-header">
          <div className="container">
            <a href="/" className="brand">RenovateConnect</a>
            <span className="muted" style={{ fontSize: 14 }}>{tagline}</span>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
