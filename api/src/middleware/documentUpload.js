// Multer config for verification-document uploads: PDF or image, up to 15 MB
// (license/insurance PDFs can be larger than a chat photo).

const multer = require('multer');

const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/webp',
]);

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF or image files are allowed'));
    }
  },
});

module.exports = documentUpload;
