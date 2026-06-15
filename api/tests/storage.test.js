// storage.uploadFile() URL precedence. Regression for the dev-mode bug where
// the request-derived host (e.g. http://192.168.x:3000) got baked into stored
// image URLs — when the Mac moved to a different WiFi, every previously-
// uploaded image broke because the URL pointed at an IP the phone could no
// longer reach. PUBLIC_BASE_URL now wins over the request-derived host so
// the URL stays stable regardless of which network the dev server is on.

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

describe('storage.uploadFile URL precedence', () => {
  test('falls back to the request-derived host when PUBLIC_BASE_URL is unset', async () => {
    delete process.env.PUBLIC_BASE_URL;
    const url = await uploadFile(Buffer.from('x'), 'image/jpeg', 'http://192.168.1.5:3000');
    expect(url.startsWith('http://192.168.1.5:3000/uploads/')).toBe(true);
    cleanupNewest();
  });

  test('PUBLIC_BASE_URL wins over the request-derived host', async () => {
    process.env.PUBLIC_BASE_URL = 'http://api.example.test:3000';
    const url = await uploadFile(Buffer.from('x'), 'image/jpeg', 'http://192.168.1.5:3000');
    expect(url.startsWith('http://api.example.test:3000/uploads/')).toBe(true);
    cleanupNewest();
  });

  test('trailing slashes on PUBLIC_BASE_URL are stripped', async () => {
    process.env.PUBLIC_BASE_URL = 'http://api.example.test:3000///';
    const url = await uploadFile(Buffer.from('x'), 'image/jpeg', 'http://ignored:3000');
    expect(url.startsWith('http://api.example.test:3000/uploads/')).toBe(true);
    expect(url).not.toContain('////');
    cleanupNewest();
  });
});
