const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Read config lazily rather than freezing it at module load. Constructing the
// S3Client eagerly threw "Region is missing" from deep inside the AWS SDK the
// moment this module was required without AWS_REGION set — crashing the process
// with an opaque @smithy/core stack trace BEFORE assertStorageConfigured()
// could report the actual problem in plain language. That's precisely the
// first-deploy case the guard exists for.
const bucket = () => process.env.S3_BUCKET;

let _s3;
function s3Client() {
  if (!_s3) _s3 = new S3Client({ region: process.env.AWS_REGION });
  return _s3;
}

// Local fallback directory (served at /uploads by app.js). Used in development
// when S3 isn't configured, or when an S3 upload fails (e.g. missing/expired
// credentials) so image uploads don't hard-fail the whole request.
const LOCAL_DIR = path.join(__dirname, '..', '..', 'uploads');

function s3Configured() {
  return Boolean(bucket() && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
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

// Persist a file and return a URL that can be loaded back. S3 returns an
// absolute https URL; the local-disk fallback returns a ROOT-RELATIVE path
// ("/uploads/<file>").
//
// The relative form is deliberate. Building an absolute URL here baked
// whatever host the upload request happened to arrive on — a Mac LAN IP, a
// .local hostname — into the database row, so every stored image broke the
// moment that machine changed networks, and was unreachable from any other
// machine forever. A relative path is host-agnostic; the absoluteUploadUrls
// middleware expands it per-request on the way out, against the host the
// client actually reached. Callers pass no base URL.
async function uploadFile(buffer, mimetype) {
  const file = `${crypto.randomUUID()}.${extFor(mimetype)}`;
  const key = `uploads/${file}`;

  if (s3Configured()) {
    try {
      await s3Client().send(
        new PutObjectCommand({ Bucket: bucket(), Key: key, Body: buffer, ContentType: mimetype })
      );
      return `https://${bucket()}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
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
  return `/${key}`;
}

// Backwards-compatible alias — existing image upload callers passed image
// content types and expected the same return shape.
const uploadImage = uploadFile;

// --- Private objects (contractor verification documents) ---------------------
//
// License, insurance, and government-ID scans must NOT be world-readable. They
// go under a `private/` prefix that the bucket policy denies public access to,
// and are handed to admins/owners as short-lived presigned URLs instead of
// permanent links. We store the KEY, never a URL — a stored URL would either
// expire (useless) or be permanent (the thing we're fixing).
const PRIVATE_PREFIX = 'private/verification';

const PRESIGN_TTL_SECONDS = () => parseInt(process.env.PRIVATE_URL_TTL_SECONDS || '300', 10);

// Upload a private document and return its S3 key. Throws when S3 isn't
// configured: unlike images, there is no acceptable local fallback for a
// government ID — the local `uploads/` dir is served publicly at /uploads, so
// falling back there would defeat the entire point. Production already can't
// boot without S3 (assertStorageConfigured), so this only bites in local dev,
// where the caller degrades gracefully instead.
async function uploadPrivateFile(buffer, mimetype) {
  if (!s3Configured()) {
    throw new Error('[storage] S3 is required for private document uploads');
  }
  const key = `${PRIVATE_PREFIX}/${crypto.randomUUID()}.${extFor(mimetype)}`;
  await s3Client().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: buffer,
    ContentType: mimetype,
  }));
  return key;
}

// Mint a short-lived read URL for a private key. Returns null when S3 isn't
// configured so callers can fall back to whatever they stored previously.
async function presignedUrlFor(key, { expiresIn = PRESIGN_TTL_SECONDS() } = {}) {
  if (!key || !s3Configured()) return null;
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn },
  );
}

module.exports = {
  uploadImage,
  uploadFile,
  uploadPrivateFile,
  presignedUrlFor,
  assertStorageConfigured,
  s3Configured,
  PRIVATE_PREFIX,
  PRESIGN_TTL_SECONDS,
};
