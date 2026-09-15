// The stored value is host-free ("/uploads/x.jpg"); clients still need an
// absolute URL. This middleware rebuilds one per-request, so the same row
// resolves against whichever host the caller actually reached.

const { expand } = require('../src/middleware/absoluteUploadUrls');

const BASE = 'http://api.example.test:3000';

const savedEnv = process.env.PUBLIC_BASE_URL;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = savedEnv;
});

describe('absoluteUploadUrls.expand', () => {
  test('expands a relative upload path', () => {
    expect(expand({ avatarUrl: '/uploads/a.jpg' }, BASE))
      .toEqual({ avatarUrl: `${BASE}/uploads/a.jpg` });
  });

  test('expands inside arrays and nested objects', () => {
    const body = { business: { portfolio: [{ imageUrls: ['/uploads/a.jpg', '/uploads/b.png'] }] } };
    expect(expand(body, BASE).business.portfolio[0].imageUrls)
      .toEqual([`${BASE}/uploads/a.jpg`, `${BASE}/uploads/b.png`]);
  });

  test('leaves absolute S3 and CDN URLs alone', () => {
    const body = {
      s3: 'https://bucket.s3.us-east-1.amazonaws.com/uploads/a.jpg',
      cdn: 'https://images.unsplash.com/photo-123?w=1000',
    };
    expect(expand(body, BASE)).toEqual(body);
  });

  test('ignores strings that merely contain /uploads/', () => {
    const body = { note: 'see /uploads/ for details', path: 'uploads/a.jpg' };
    expect(expand(body, BASE)).toEqual(body);
  });

  test('passes through null, numbers, booleans and Dates untouched', () => {
    const when = new Date('2026-01-01T00:00:00Z');
    const body = { a: null, b: 3, c: true, d: when };
    const out = expand(body, BASE);
    expect(out.d).toBe(when);
    expect(out).toEqual(body);
  });

  test('does not mutate an unchanged body (module-level config stays intact)', () => {
    const shared = Object.freeze({ id: 'the-project', options: Object.freeze(['Kitchen']) });
    expect(expand(shared, BASE)).toBe(shared);
  });
});
