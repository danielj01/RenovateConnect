// CORS allowlist.
//
// This exists because of a real outage: renovateconnect.com 308-redirects to
// www, so every browser's Origin was `https://www.renovateconnect.com` while
// WEB_ORIGINS held only the apex. Every browser write was CORS-blocked — the
// public waitlist form could never submit — and because a refused origin just
// omits the CORS headers (200, no error), nothing showed up in the logs or in
// Sentry. The only symptom was users saying "it won't let me sign up."
//
// `app` is required lazily per-case: the allowlist is built once at module
// load from WEB_ORIGINS, so each scenario needs a fresh module registry.

const request = require('supertest');

function appWith(webOrigins) {
  let loaded;
  jest.isolateModules(() => {
    const prev = process.env.WEB_ORIGINS;
    if (webOrigins === undefined) delete process.env.WEB_ORIGINS;
    else process.env.WEB_ORIGINS = webOrigins;
    loaded = require('../src/app');
    if (prev === undefined) delete process.env.WEB_ORIGINS;
    else process.env.WEB_ORIGINS = prev;
  });
  return loaded;
}

/** Returns the access-control-allow-origin header for a preflight, or undefined. */
async function preflight(app, origin) {
  const res = await request(app)
    .options('/waitlist')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'POST');
  return res.headers['access-control-allow-origin'];
}

describe('CORS origin allowlist', () => {
  test('allows the exact configured origin', async () => {
    const app = appWith('https://renovateconnect.com');
    expect(await preflight(app, 'https://renovateconnect.com'))
      .toBe('https://renovateconnect.com');
  });

  test('allows the www counterpart of a configured apex (the outage)', async () => {
    const app = appWith('https://renovateconnect.com');
    expect(await preflight(app, 'https://www.renovateconnect.com'))
      .toBe('https://www.renovateconnect.com');
  });

  test('allows the apex counterpart of a configured www host', async () => {
    const app = appWith('https://www.renovateconnect.com');
    expect(await preflight(app, 'https://renovateconnect.com'))
      .toBe('https://renovateconnect.com');
  });

  test('pairing is not wildcard subdomain matching', async () => {
    const app = appWith('https://renovateconnect.com');
    expect(await preflight(app, 'https://evil.renovateconnect.com')).toBeUndefined();
    expect(await preflight(app, 'https://www.evil.renovateconnect.com')).toBeUndefined();
  });

  test('refuses an unrelated origin, and a lookalike domain', async () => {
    const app = appWith('https://renovateconnect.com');
    expect(await preflight(app, 'https://evil.example.com')).toBeUndefined();
    expect(await preflight(app, 'https://renovateconnect.com.evil.example')).toBeUndefined();
  });

  test('does not cross protocols or ports', async () => {
    const app = appWith('https://renovateconnect.com');
    expect(await preflight(app, 'http://renovateconnect.com')).toBeUndefined();
    expect(await preflight(app, 'https://renovateconnect.com:8443')).toBeUndefined();
  });

  test('honours every entry in a comma-separated list', async () => {
    const app = appWith('http://localhost:3000, https://renovateconnect.com');
    expect(await preflight(app, 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(await preflight(app, 'https://www.renovateconnect.com'))
      .toBe('https://www.renovateconnect.com');
  });

  test('a request with no Origin (native app, curl) is unaffected', async () => {
    const app = appWith('https://renovateconnect.com');
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
