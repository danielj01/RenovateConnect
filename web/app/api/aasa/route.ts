// Apple App Site Association — lets the iOS app claim https links so /b/:id and
// /estimate open the app directly instead of the website. Reached via the
// rewrite in next.config.mjs at /.well-known/apple-app-site-association.
//
// appID = <TeamID>.<BundleID>. Set IOS_APP_ID in the deploy env once the app has
// a real signing team + bundle id (see LAUNCH_READINESS.md §3.1).

export const dynamic = 'force-dynamic';

export function GET() {
  const appID = process.env.IOS_APP_ID || 'TEAMID.app.renovateconnect';

  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appID,
          // Paths the app handles. Profiles + the estimator front door.
          paths: ['/b/*', '/estimate', '/estimate/*', '/e/*'],
        },
      ],
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
