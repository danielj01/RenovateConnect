// Add licensed stock photography to the LOCAL demo feed. Never resets existing data.
// Run from api/: node --env-file=.env scripts/seed-local-inspiration.js
const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs/promises');
const path = require('node:path');
const photos = require('../prisma/fixtures/local-inspiration-photos.json');
const db = new PrismaClient();

async function main() {
  const database = new URL(process.env.DATABASE_URL);
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
    throw new Error('This sample-photo seed only supports a local development database.');
  }
  const businesses = await db.business.findMany({
    where: { user: { email: { endsWith: '@renovateconnect.dev' } }, approvalStatus: 'APPROVED', proStatus: 'active' },
    select: { id: true, companyName: true },
  });
  const byName = Object.fromEntries(businesses.map(b => [b.companyName, b.id]));
  const owners = {
    Kitchen: 'Elite Kitchen & Bath', Bathroom: 'Peak Renovations LLC',
    Bedroom: 'Metro Home Builders', 'Living room': 'Metro Home Builders',
    Exterior: 'Metro Home Builders', 'Whole home': 'Artisan Painters',
  };
  for (const name of Object.values(owners)) {
    if (!byName[name]) throw new Error(`Missing listed demo contractor: ${name}`);
  }
  const uploadDir = path.resolve(__dirname, '../uploads');
  await fs.mkdir(uploadDir, { recursive: true });
  // Validate every image before inserting any feed records.
  for (const photo of photos) {
    const target = path.join(uploadDir, `demo-pexels-${photo.photoId}.jpg`);
    let image;
    try { image = await fs.readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!image) {
      const response = await fetch(photo.imageUrl, { signal: AbortSignal.timeout(30000) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
        throw new Error(`Photo ${photo.photoId}: HTTP ${response.status}`);
      }
      image = Buffer.from(await response.arrayBuffer());
    }
    if (image.length < 5000 || image[0] !== 0xff || image[1] !== 0xd8) {
      throw new Error(`Photo ${photo.photoId} is not a valid JPEG`);
    }
    await fs.writeFile(target, image);
    console.log(`Ready: ${photo.photoId} (${photo.category})`);
  }
  const now = Date.now();
  const result = await db.inspirationPost.createMany({
    skipDuplicates: true,
    data: photos.map((photo, i) => ({
      id: `local-demo-pexels-${photo.photoId}`,
      businessId: byName[owners[photo.category]],
      title: photo.title, category: photo.category,
      caption: `Local demo inspiration — licensed stock photography, not completed work by this contractor. Photo: ${photo.photographer} / Pexels. Source: ${photo.source} License: ${photo.license}`,
      imageUrls: [`/uploads/demo-pexels-${photo.photoId}.jpg`], beforeImageUrls: [],
      approvalStatus: 'APPROVED', reviewedAt: new Date(),
      createdAt: new Date(now - i * 1000),
    })),
  });
  console.log(`Added ${result.count} inspiration posts; existing content preserved.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
