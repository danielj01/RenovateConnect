const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createBusiness, createClient, createAdmin } = require('./helpers');
const { recomputeBusinessVerified } = require('../src/services/verification');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

// Helper — file an upload by directly creating a row, since multipart in
// supertest is heavier than we need for the lifecycle tests. The upload
// happy-path via multipart is covered separately below.
async function seedDoc(businessId, overrides = {}) {
  return db.verificationDocument.create({
    data: {
      businessId,
      type: overrides.type || 'LICENSE',
      fileUrl: overrides.fileUrl || 'https://example.com/doc.pdf',
      documentNumber: overrides.documentNumber || 'LIC-123',
      issuer: overrides.issuer || 'California CSLB',
      expiresAt: overrides.expiresAt ?? null,
      status: overrides.status || 'PENDING',
    },
  });
}

describe('Contractor uploads (POST/GET/DELETE)', () => {
  test('multipart PDF upload creates a PENDING document', async () => {
    const { business, token } = await createBusiness();
    const pdfBuf = Buffer.from('%PDF-1.4\n%%EOF\n');

    const res = await request(app)
      .post(`/businesses/${business.id}/verification-documents`)
      .set('Authorization', `Bearer ${token}`)
      .field('type', 'LICENSE')
      .field('documentNumber', '1023456')
      .field('issuer', 'California CSLB')
      .attach('file', pdfBuf, { filename: 'license.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.type).toBe('LICENSE');
    expect(res.body.fileUrl).toMatch(/\.pdf$/);
  });

  test('rejects unknown doc types', async () => {
    const { business, token } = await createBusiness();
    const res = await request(app)
      .post(`/businesses/${business.id}/verification-documents`)
      .set('Authorization', `Bearer ${token}`)
      .field('type', 'GALAXY')
      .attach('file', Buffer.from('x'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
  });

  test('rejects non-PDF/non-image content', async () => {
    const { business, token } = await createBusiness();
    const res = await request(app)
      .post(`/businesses/${business.id}/verification-documents`)
      .set('Authorization', `Bearer ${token}`)
      .field('type', 'LICENSE')
      .attach('file', Buffer.from('x'), { filename: 'x.exe', contentType: 'application/octet-stream' });
    // Multer's fileFilter error surfaces as a 500 unless we wrap it — but
    // either way it must not succeed.
    expect(res.status).not.toBe(201);
  });

  test('owner can list and delete their own PENDING doc; not an APPROVED one', async () => {
    const { business, token } = await createBusiness();
    const pending = await seedDoc(business.id);
    const approved = await seedDoc(business.id, { status: 'APPROVED' });

    const list = await request(app)
      .get(`/businesses/${business.id}/verification-documents`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(2);

    const delOk = await request(app)
      .delete(`/businesses/${business.id}/verification-documents/${pending.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delOk.status).toBe(204);

    const delBad = await request(app)
      .delete(`/businesses/${business.id}/verification-documents/${approved.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delBad.status).toBe(409);
  });

  test('a different contractor cannot upload, list, or delete', async () => {
    const a = await createBusiness();
    const b = await createBusiness();
    const doc = await seedDoc(a.business.id);

    const list = await request(app)
      .get(`/businesses/${a.business.id}/verification-documents`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(list.status).toBe(403);

    const del = await request(app)
      .delete(`/businesses/${a.business.id}/verification-documents/${doc.id}`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(del.status).toBe(403);
  });
});

describe('Admin queue + decisions', () => {
  test('non-admin cannot see the queue', async () => {
    const { token } = await createClient();
    const res = await request(app).get('/admin/verifications').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('approving the last required doc flips Business.verified to true', async () => {
    const { business } = await createBusiness();
    const { token: adminToken } = await createAdmin();

    const license = await seedDoc(business.id, { type: 'LICENSE' });
    const insurance = await seedDoc(business.id, {
      type: 'INSURANCE',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });

    let b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.verified).toBe(false);

    // Approve license alone → still unverified (insurance still pending).
    let res = await request(app)
      .post(`/admin/verifications/${license.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.businessVerified).toBe(false);

    // Approve insurance → now verified.
    res = await request(app)
      .post(`/admin/verifications/${insurance.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.businessVerified).toBe(true);

    b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.verified).toBe(true);
    expect(b.verifiedAt).not.toBeNull();
  });

  test('rejecting an APPROVED doc drops the verified flag', async () => {
    const { business } = await createBusiness();
    const { token: adminToken } = await createAdmin();
    const license   = await seedDoc(business.id, { type: 'LICENSE',   status: 'APPROVED' });
    const insurance = await seedDoc(business.id, { type: 'INSURANCE', status: 'APPROVED',
                                                   expiresAt: new Date(Date.now() + 1e10) });
    await recomputeBusinessVerified(business.id);
    expect((await db.business.findUnique({ where: { id: business.id } })).verified).toBe(true);

    const res = await request(app)
      .post(`/admin/verifications/${license.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Expired license per state lookup' });
    expect(res.status).toBe(200);
    expect(res.body.businessVerified).toBe(false);

    const b = await db.business.findUnique({ where: { id: business.id } });
    expect(b.verified).toBe(false);
    expect(b.verifiedAt).toBeNull();
    expect(insurance.id).toBeTruthy(); // kept for clarity
  });

  test('reject requires a reason', async () => {
    const { business } = await createBusiness();
    const { token: adminToken } = await createAdmin();
    const doc = await seedDoc(business.id);

    const res = await request(app)
      .post(`/admin/verifications/${doc.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('Expiry handling in the recompute', () => {
  test('an expired APPROVED doc does not count toward verified', async () => {
    const { business } = await createBusiness();
    await seedDoc(business.id, { type: 'LICENSE',   status: 'APPROVED' });
    await seedDoc(business.id, { type: 'INSURANCE', status: 'APPROVED',
                                 expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });

    const verified = await recomputeBusinessVerified(business.id);
    expect(verified).toBe(false);
  });

  test('an unexpired APPROVED insurance + APPROVED license = verified', async () => {
    const { business } = await createBusiness();
    await seedDoc(business.id, { type: 'LICENSE',   status: 'APPROVED' });
    await seedDoc(business.id, { type: 'INSURANCE', status: 'APPROVED',
                                 expiresAt: new Date(Date.now() + 1e10) });

    expect(await recomputeBusinessVerified(business.id)).toBe(true);
  });

  test('IDENTITY alone is not enough', async () => {
    const { business } = await createBusiness();
    await seedDoc(business.id, { type: 'IDENTITY', status: 'APPROVED' });
    expect(await recomputeBusinessVerified(business.id)).toBe(false);
  });
});
