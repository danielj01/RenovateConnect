import Link from 'next/link';
import { appStoreUrl, hasAppStoreListing } from '@/lib/config';

export default function NotFound() {
  return (
    <main className="container center" style={{ maxWidth: 560 }}>
      <h1>We couldn&rsquo;t find that page</h1>
      <p className="lede">
        The link may be mistyped, or a contractor may have removed their profile.
      </p>

      <div className="btn-row mt-8" style={{ justifyContent: 'center' }}>
        <Link className="btn btn-primary" href="/estimate">Get an instant estimate</Link>
        <Link className="btn btn-ghost" href="/cost">Browse cost guides</Link>
      </div>

      {hasAppStoreListing ? (
        <p className="mt-6">
          <a href={appStoreUrl}>Or explore contractors in the app</a>
        </p>
      ) : null}
    </main>
  );
}
