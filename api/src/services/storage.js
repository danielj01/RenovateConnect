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

// Persist an image and return a URL that can be loaded back. Prefers S3; falls
// back to local disk. `baseUrl` (e.g. "http://192.168.1.5:3000") is used to
// build an absolute URL for the local fallback so devices on the LAN can fetch
// it — pass `${req.protocol}://${req.get('host')}` from the route.
async function uploadImage(buffer, mimetype, baseUrl) {
  const file = `${crypto.randomUUID()}.jpg`;
  const key = `uploads/${file}`;

  if (s3Configured()) {
    try {
      await s3.send(
        new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: mimetype })
      );
      return `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    } catch (err) {
      // Don't block development on bad credentials — fall through to local disk.
      console.warn(`[storage] S3 upload failed (${err.message}); saving to local disk`);
    }
  }

  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_DIR, file), buffer);
  const base = (baseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/${key}`;
}

module.exports = { uploadImage };
