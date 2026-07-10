// The estimator used to hardcode media_type: 'image/jpeg', so any non-JPEG
// upload (PNG screenshots, WebP, and especially iPhone HEIC) failed at the
// Anthropic API. These tests cover the byte-sniffing that replaced it.
const { mediaTypeFromBuffer, mediaTypeFromBase64 } = require('../src/services/ai');

// Minimal magic-byte headers for each format.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBP'),
]);
// ISO-BMFF box: size + "ftyp" + brand "heic".
const HEIC = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftyp'), Buffer.from('heic'),
]);

describe('image media-type detection', () => {
  test('detects the four Anthropic-supported formats from bytes', () => {
    expect(mediaTypeFromBuffer(JPEG)).toBe('image/jpeg');
    expect(mediaTypeFromBuffer(PNG)).toBe('image/png');
    expect(mediaTypeFromBuffer(GIF)).toBe('image/gif');
    expect(mediaTypeFromBuffer(WEBP)).toBe('image/webp');
  });

  test('detects the same formats from base64', () => {
    expect(mediaTypeFromBase64(PNG.toString('base64'))).toBe('image/png');
    expect(mediaTypeFromBase64(WEBP.toString('base64'))).toBe('image/webp');
  });

  test('rejects HEIC with a clear, client-safe 415', () => {
    let err;
    try { mediaTypeFromBuffer(HEIC); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.status).toBe(415);
    expect(err.expose).toBe(true);
    expect(err.message).toMatch(/HEIC/i);
  });

  test('rejects an unrecognized format with a 415', () => {
    let err;
    try { mediaTypeFromBuffer(Buffer.from([0x00, 0x01, 0x02, 0x03])); } catch (e) { err = e; }
    expect(err.status).toBe(415);
    expect(err.message).toMatch(/JPEG or PNG/i);
  });
});
