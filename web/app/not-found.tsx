import { appStoreUrl } from '@/lib/config';

export default function NotFound() {
  return (
    <main className="container" style={{ textAlign: 'center', paddingTop: 64 }}>
      <h1 style={{ fontSize: 28 }}>This profile isn’t available</h1>
      <p className="muted">
        The contractor may have removed their profile, or the link is incorrect.
      </p>
      <a className="btn btn-primary" href={appStoreUrl} style={{ marginTop: 12 }}>
        Explore contractors in the app
      </a>
    </main>
  );
}
