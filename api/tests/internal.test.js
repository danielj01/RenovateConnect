const request = require('supertest');
const app = require('../src/app');

// The middleware reads INTERNAL_API_KEY at request time, so we can toggle it
// per-test via process.env without re-requiring the app.
describe('POST /internal/sweep', () => {
  const ORIGINAL = process.env.INTERNAL_API_KEY;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = ORIGINAL;
  });

  it('is disabled (503) when INTERNAL_API_KEY is not set', async () => {
    delete process.env.INTERNAL_API_KEY;
    const res = await request(app).post('/internal/sweep');
    expect(res.status).toBe(503);
  });

  it('rejects a missing or wrong key with 401', async () => {
    process.env.INTERNAL_API_KEY = 'secret-key';
    const noKey = await request(app).post('/internal/sweep');
    expect(noKey.status).toBe(401);
    const wrongKey = await request(app).post('/internal/sweep').set('x-internal-key', 'nope');
    expect(wrongKey.status).toBe(401);
  });

  it('runs the sweep and returns the released count with a valid key', async () => {
    process.env.INTERNAL_API_KEY = 'secret-key';
    const res = await request(app).post('/internal/sweep').set('x-internal-key', 'secret-key');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.released).toBe('number');
  });
});
