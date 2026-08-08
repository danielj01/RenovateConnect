// Verification documents include government-ID scans. They were previously
// written to the public S3 prefix and stored as durable public URLs, so anyone
// with the link could read someone's ID. These tests pin the replacement:
// private-prefix upload + short-lived presigned reads, with no durable link
// ever leaving the API.
//
// S3 is stubbed — we assert on WHAT the code asks S3 to do, not on AWS itself.
jest.mock('../src/services/storage', () => {
  const actual = jest.requireActual('../src/services/storage');
  return {
    ...actual,
    s3Configured: jest.fn(() => true),
    uploadPrivateFile: jest.fn(async () => 'private/verification/abc-123.pdf'),
    uploadFile: jest.fn(async () => 'https://bucket.s3.amazonaws.com/uploads/public.pdf'),
    presignedUrlFor: jest.fn(async (key) => (key ? `https://signed.example/${key}?X-Amz-Expires=300` : null)),
  };
});

const request = require('supertest');
const app = require('../src/app');
const storage = require('../src/services/storage');
const { db, resetDb, createBusiness, createAdmin } = require('./helpers');

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  storage.s3Configured.mockReturnValue(true);
});
afterAll(async () => { await db.$disconnect(); });

const PDF = Buffer.from('%PDF-1.4 fake');

async function upload(businessId, token, type = 'IDENTITY') {
  return request(app)
    .post(`/businesses/${businessId}/verification-documents`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', PDF, 'id.pdf')
    .field('type', type);
}

describe('Private upload', () => {
  test('an ID document goes to the private prefix, not the public one', async () => {
    const { business, token } = await createBusiness();
    const res = await upload(business.id, token);
    expect(res.status).toBe(201);

    expect(storage.uploadPrivateFile).toHaveBeenCalledTimes(1);
    expect(storage.uploadFile).not.toHaveBeenCalled();

    // The durable public URL column is left empty; only the key is persisted.
    const row = await db.verificationDocument.findFirst({ where: { businessId: business.id } });
    expect(row.storageKey).toMatch(/^private\/verification\//);
    expect(row.fileUrl).toBe('');
  });

  test('the upload response hands back a presigned URL, never a bare key', async () => {
    const { business, token } = await createBusiness();
    const res = await upload(business.id, token);
    expect(res.body.fileUrl).toMatch(/^https:\/\/signed\.example\//);
    expect(res.body.fileUrl).toMatch(/X-Amz-Expires/);
  });
});

describe('Private reads', () => {
  test('the owner listing returns presigned URLs', async () => {
    const { business, token } = await createBusiness();
    await upload(business.id, token);

    const res = await request(app)
      .get(`/businesses/${business.id}/verification-documents`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].fileUrl).toMatch(/^https:\/\/signed\.example\//);
    expect(storage.presignedUrlFor).toHaveBeenCalledWith(expect.stringMatching(/^private\//));
  });

  test('the admin queue returns presigned URLs too', async () => {
    const { business, token } = await createBusiness();
    await upload(business.id, token);
    const { token: adminToken } = await createAdmin();

    const res = await request(app).get('/admin/verifications')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body[0].fileUrl).toMatch(/^https:\/\/signed\.example\//);
  });

  test('a stranger still cannot list another business\'s documents', async () => {
    const { business, token } = await createBusiness();
    await upload(business.id, token);
    const { token: otherToken } = await createBusiness({ email: 'other@t.com' });

    const res = await request(app)
      .get(`/businesses/${business.id}/verification-documents`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Legacy rows and local dev', () => {
  test('a legacy row with no storageKey still resolves via its stored URL', async () => {
    const { business, token } = await createBusiness();
    await db.verificationDocument.create({
      data: {
        businessId: business.id,
        type: 'LICENSE',
        fileUrl: 'https://bucket.s3.amazonaws.com/uploads/legacy.pdf',
        storageKey: null,
      },
    });

    const res = await request(app)
      .get(`/businesses/${business.id}/verification-documents`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.body[0].fileUrl).toBe('https://bucket.s3.amazonaws.com/uploads/legacy.pdf');
  });

  test('without S3 (local dev) it falls back to the ordinary upload path', async () => {
    storage.s3Configured.mockReturnValue(false);
    const { business, token } = await createBusiness();
    const res = await upload(business.id, token, 'LICENSE');

    expect(res.status).toBe(201);
    expect(storage.uploadPrivateFile).not.toHaveBeenCalled();
    expect(storage.uploadFile).toHaveBeenCalledTimes(1);
    const row = await db.verificationDocument.findFirst({ where: { businessId: business.id } });
    expect(row.storageKey).toBeNull();
  });
});
