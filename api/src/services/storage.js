const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BUCKET = process.env.S3_BUCKET;
const s3 = new S3Client({ region: process.env.AWS_REGION });

// Local fallback directory (served at /uploads by app.js). Used in development
// when S3 isn't configured, or when an S3 upload fails (e.g. missing/expired
// credentials) so image uploads don't hard-fail the whole request.
const LOCAL_DIR = path.join(__dirname, '..', '..', 'uploads');

function s3Configured() {
  return Boolean(BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

// Called at boot. The local-disk fallback is ephemeral on every PaaS (the
// filesystem is wiped on each deploy), so a production server without S3 would
// silently lose every uploaded photo. Fail fast instead of discovering it later.
function assertStorageConfigured() {
  if (isProduction() && !s3Configured()) {
    throw new Error(
      '[storage] S3 is required in production (set S3_BUCKET, AWS_ACCESS_KEY_ID, ' +
      'AWS_SECRET_ACCESS_KEY, AWS_REGION). Refusing to start with the ephemeral ' +
      'local-disk fallback, which loses uploads on every deploy.'
    );
  }
}

// Map a content-type to a file extension. Defaults to jpg for unknown image
// payloads so existing image flows keep their previous behaviour.
function extFor(mimetype) {
  switch (mimetype) {
    case 'application/pdf': return 'pdf';
    case 'image/png':       return 'png';
    case 'image/gif':       return 'gif';
    case 'image/webp':      return 'webp';
    case 'image/heic':      return 'heic';
    case 'image/jpeg':
    case 'image/jpg':
    default:                return 'jpg';
  }
}

// Persist a file and return a URL that can be loaded back. Prefers S3; falls
// back to local disk. `baseUrl` (e.g. "http://192.168.1.5:3000") is used to
// build an absolute URL for the local fallback so devices on the LAN can fetch
// it — pass `${req.protocol}://${req.get('host')}` from the route.
async function uploadFile(buffer, mimetype, baseUrl) {
  const file = `${crypto.randomUUID()}.${extFor(mimetype)}`;
  const key = `uploads/${file}`;

  if (s3Configured()) {
    try {
      await s3.send(
        new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: mimetype })
      );
      return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    } catch (err) {
      // In production the local-disk fallback is ephemeral, so silently saving
      // there would lose the image on the next deploy. Surface the failure
      // instead. In dev, fall through to disk so bad/expired creds don't block.
      if (isProduction()) throw err;
      console.warn(`[storage] S3 upload failed (${err.message}); saving to local disk`);
    }
  }

  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_DIR, file), buffer);
  const base = (baseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/${key}`;
}

// Backwards-compatible alias — existing image upload callers passed image
// content types and expected the same return shape.
const uploadImage = uploadFile;

module.exports = { uploadImage, uploadFile, assertStorageConfigured, s3Configured };
