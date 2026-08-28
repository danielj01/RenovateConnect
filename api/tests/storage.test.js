// storage.uploadFile() must never persist a hostname. Regression for the
// dev-mode bug where the request-derived host (e.g. http://192.168.x:3000, or
// the Mac's .local name) got baked into stored image URLs — when the Mac moved
// to a different WiFi, every previously-uploaded image broke, because the row
// pointed at an address the phone could no longer reach. Local uploads are now
// stored root-relative and made absolute per-request on the way out; see
// middleware/absoluteUploadUrls.js.

const fs = require('fs');
const path = require('path');
const { uploadFile } = require('../src/services/storage');

const LOCAL_DIR = path.join(__dirname, '..', 'uploads');

function cleanupNewest(n = 1) {
  if (!fs.existsSync(LOCAL_DIR)) return;
  const files = fs.readdirSync(LOCAL_DIR)
    .map((f) => ({ f, t: fs.statSync(path.join(LOCAL_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, n);
  for (const { f } of files) {
    try { fs.unlinkSync(path.join(LOCAL_DIR, f)); } catch { /* best-effort */ }
  }
}

const savedEnv = process.env.PUBLIC_BASE_URL;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = savedEnv;
});

describe('storage.uploadFile local fallback', () => {
  test('returns a root-relative path, not an absolute URL', async () => {
    delete process.env.PUBLIC_BASE_URL;
    const url = await uploadFile(Buffer.from('x'), 'image/jpeg');
    expect(url).toMatch(/^\/uploads\/[\w-]+\.jpg$/);
    cleanupNewest();
  });

  test('PUBLIC_BASE_URL does not leak into the stored value', async () => {
    process.env.PUBLIC_BASE_URL = 'http://api.example.test:3000';
    const url = await uploadFile(Buffer.from('x'), 'image/jpeg');
    expect(url.startsWith('/uploads/')).toBe(true);
    expect(url).not.toContain('api.example.test');
    cleanupNewest();
  });

  test('an extra base-url argument is ignored rather than baked in', async () => {
    delete process.env.PUBLIC_BASE_URL;
    const url = await uploadFile(Buffer.from('x'), 'image/jpeg', 'http://192.168.1.5:3000');
    expect(url).not.toContain('192.168.1.5');
    expect(url.startsWith('/uploads/')).toBe(true);
    cleanupNewest();
  });
});
