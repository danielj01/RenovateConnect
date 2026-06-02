// npx prisma db seed
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const businesses = [
  {
    email: 'peak@renovateconnect.dev',
    name: 'Marcus Webb',
    companyName: 'Peak Renovations LLC',
    description: 'Premium full-service renovations with 15 years of experience across Chicagoland. We specialize in high-end kitchen and bathroom remodels, bringing design-forward thinking and flawless craftsmanship to every project. Licensed, bonded, and insured.',
    city: 'Chicago', state: 'IL', zipCode: '60601',
    specialties: ['Kitchen', 'Bathroom', 'Basement'],
    yearsInBusiness: 15,
    website: 'https://peakrenovations.dev',
    isPromoted: true,
    averageRating: 4.9,
    profileViews: 1284,
    portfolio: [
      { title: 'Lincoln Park Chef\'s Kitchen', category: 'Kitchen', description: 'Full gut remodel with custom walnut cabinetry, quartz waterfall island, and a pro-grade appliance package.', costMin: 62000, costMax: 78000, durationWeeks: 7, featured: true },
      { title: 'Spa Master Bath', category: 'Bathroom', description: 'Curbless walk-in shower, heated floors, and a freestanding soaking tub.', costMin: 34000, costMax: 45000, durationWeeks: 5 },
      { title: 'Finished Basement Suite', category: 'Basement', description: 'Added a guest bedroom, full bath, and wet bar with egress window.', costMin: 48000, costMax: 60000, durationWeeks: 8 },
    ],
    reviews: [
      { authorName: 'Sarah L.', rating: 5, body: 'Peak transformed our outdated kitchen into a showpiece. Marcus and his team were professional, clean, and finished ahead of schedule. Highly recommend!' },
      { authorName: 'Tom R.', rating: 5, body: 'Best contractor I have ever worked with. Our bathroom remodel came out better than we imagined. Worth every penny.' },
      { authorName: 'Jessica M.', rating: 5, body: 'Incredible attention to detail. Our basement is now a proper living space. Peak did everything — framing, drywall, flooring, lighting.' },
      { authorName: 'David K.', rating: 4, body: 'Really happy with the result. Communication was excellent throughout the project. Minor timeline slip but they kept us informed.' },
    ],
  },
  {
    email: 'metro@renovateconnect.dev',
    name: 'Lisa Torres',
    companyName: 'Metro Home Builders',
    description: 'Full-service renovation company serving Chicagoland since 2013. From small bathroom updates to full home remodels, our team of 20 tradespeople handles it all under one roof. Known for our transparent pricing and on-time delivery.',
    city: 'Chicago', state: 'IL', zipCode: '60607',
    specialties: ['Kitchen', 'Bathroom', 'Flooring', 'Painting'],
    yearsInBusiness: 12,
    isPromoted: true,
    averageRating: 4.7,
    profileViews: 947,
    portfolio: [
      { title: 'West Loop Whole-Floor Remodel', category: 'Kitchen', description: 'New hardwood throughout, repainted interior, and a modern backsplash refresh.', costMin: 40000, costMax: 55000, durationWeeks: 6, featured: true },
      { title: '10-Day Bathroom Refresh', category: 'Bathroom', description: 'Fast-turnaround guest bath remodel with new vanity, tile, and fixtures.', costMin: 12000, costMax: 18000, durationWeeks: 2 },
    ],
    reviews: [
      { authorName: 'Amanda P.', rating: 5, body: 'Metro handled our whole first floor — new hardwood, painted every room, and redid the kitchen backsplash. Seamless experience.' },
      { authorName: 'Brian H.', rating: 5, body: 'Fair pricing, great communication. They finished our bathroom remodel in 10 days flat.' },
      { authorName: 'Karen S.', rating: 4, body: 'Solid crew, beautiful work. Had a small issue with grout color but they fixed it same day, no questions asked.' },
      { authorName: 'Mike T.', rating: 5, body: 'Third time using Metro. They know what they\'re doing and it shows.' },
      { authorName: 'Priya N.', rating: 4, body: 'Good quality work overall. Project came in on budget which I appreciated.' },
    ],
  },
  {
    email: 'elite@renovateconnect.dev',
    name: 'Ryan Kessler',
    companyName: 'Elite Kitchen & Bath',
    description: 'Boutique design-build firm focused exclusively on kitchens and bathrooms. We partner with top material suppliers and bring a designer eye to every project. Small team, personal service, exceptional results.',
    city: 'Naperville', state: 'IL', zipCode: '60540',
    specialties: ['Kitchen', 'Bathroom'],
    yearsInBusiness: 8,
    website: 'https://elitekb.dev',
    averageRating: 4.8,
    profileViews: 612,
    portfolio: [
      { title: 'Naperville Showcase Kitchen', category: 'Kitchen', description: 'Designer layout with a 10-ft island, brass fixtures, and integrated paneled appliances.', costMin: 70000, costMax: 95000, durationWeeks: 9, featured: true },
      { title: 'Hers & His Master Bath', category: 'Bathroom', description: 'Double vanity, marble wet room, and custom built-in storage.', costMin: 38000, costMax: 52000, durationWeeks: 6 },
    ],
    reviews: [
      { authorName: 'Claire W.', rating: 5, body: 'Ryan has a real designer\'s eye. Our kitchen is stunning — the cabinet layout he suggested was so much better than our original plan.' },
      { authorName: 'James B.', rating: 5, body: 'Worth the premium. Materials were top shelf, craftsmanship was flawless, and the timeline was exactly as promised.' },
      { authorName: 'Michelle D.', rating: 5, body: 'Phenomenal master bath remodel. Every detail was thought through.' },
      { authorName: 'Steve A.', rating: 4, body: 'High quality but premium pricing. If you want the best kitchen in the neighborhood, call Ryan.' },
    ],
  },
  {
    email: 'proroof@renovateconnect.dev',
    name: 'Derek Hanson',
    companyName: 'ProRoof Solutions',
    description: 'Trusted roofing contractor with 20 years serving the greater Chicago area. We handle full roof replacements, repairs, gutters, and skylights. GAF Master Elite certified. All work is backed by our 10-year workmanship warranty.',
    city: 'Chicago', state: 'IL', zipCode: '60625',
    specialties: ['Roofing'],
    yearsInBusiness: 20,
    averageRating: 4.6,
    reviews: [
      { authorName: 'Robert C.', rating: 5, body: 'ProRoof replaced our 25-year-old roof in two days. Clean, professional, and great price. No debris left behind.' },
      { authorName: 'Nancy G.', rating: 4, body: 'Solid roof replacement. Derek explained everything clearly upfront. No hidden costs.' },
      { authorName: 'Eric M.', rating: 5, body: 'Fixed a long-standing leak that two other roofers couldn\'t find. Highly recommend.' },
      { authorName: 'Linda F.', rating: 4, body: 'Good work, fair price. They also replaced our gutters and everything looks great.' },
    ],
  },
  {
    email: 'spark@renovateconnect.dev',
    name: 'Tony Ferrara',
    companyName: 'Bright Spark Electric',
    description: 'Licensed electricians and HVAC technicians available 7 days a week across Chicago. We handle panel upgrades, EV charger installation, rewiring, smart home systems, and full HVAC installation and replacement.',
    city: 'Chicago', state: 'IL', zipCode: '60614',
    specialties: ['Electrical', 'HVAC'],
    yearsInBusiness: 10,
    averageRating: 4.5,
    reviews: [
      { authorName: 'Dan W.', rating: 5, body: 'Had our 100A panel upgraded to 200A and a Tesla charger installed. Tony\'s team was fast, clean, and passed inspection first try.' },
      { authorName: 'Susan K.', rating: 4, body: 'Quick response for our furnace issue. Fixed same day. Very reasonable rate.' },
      { authorName: 'Frank L.', rating: 5, body: 'Rewired our 1920s greystone. Big job done right. Tony was very communicative throughout.' },
      { authorName: 'Amy V.', rating: 4, body: 'Good work on our AC install. On time and professional.' },
    ],
  },
  {
    email: 'flowright@renovateconnect.dev',
    name: 'Carlos Mendez',
    companyName: 'FlowRight Plumbing',
    description: 'Fully licensed master plumbers serving Chicago and suburbs. Specializing in bathroom rough-ins, kitchen plumbing, water heater installation, and leak detection. Emergency service available 24/7.',
    city: 'Evanston', state: 'IL', zipCode: '60201',
    specialties: ['Plumbing'],
    yearsInBusiness: 7,
    averageRating: 4.7,
    reviews: [
      { authorName: 'Janet H.', rating: 5, body: 'Carlos fixed a hidden slab leak that was destroying our floor. Found it fast, fixed it right, and saved us thousands.' },
      { authorName: 'Mark P.', rating: 5, body: 'Installed a new tankless water heater — clean, fast, great price.' },
      { authorName: 'Donna R.', rating: 4, body: 'Good plumber. Came out same day and fixed our kitchen leak.' },
    ],
  },
  {
    email: 'artisan@renovateconnect.dev',
    name: 'Elena Park',
    companyName: 'Artisan Painters',
    description: 'Interior and exterior painting specialists. We use premium zero-VOC paints, do all our own prep work, and are obsessed with crisp lines and perfect finishes. Residential and light commercial.',
    city: 'Oak Park', state: 'IL', zipCode: '60302',
    specialties: ['Painting'],
    yearsInBusiness: 5,
    averageRating: 4.9,
    reviews: [
      { authorName: 'Lisa N.', rating: 5, body: 'Elena painted our whole house interior — immaculate work. The trim lines are perfect. We\'ve already referred three neighbors.' },
      { authorName: 'Paul S.', rating: 5, body: 'Exterior repaint before we listed our house. It looked brand new. Got multiple compliments from realtors.' },
      { authorName: 'Rachel B.', rating: 5, body: 'Fast, clean, and affordable. Zero mess left behind. Will use again for sure.' },
    ],
  },
  {
    email: 'premier@renovateconnect.dev',
    name: 'James Okafor',
    companyName: 'Premier Flooring Co',
    description: 'Hardwood, LVP, tile, and carpet installation specialists with 11 years in Chicago. We handle everything from subfloor repair to final finish. Free in-home estimates and material sourcing assistance.',
    city: 'Chicago', state: 'IL', zipCode: '60618',
    specialties: ['Flooring'],
    yearsInBusiness: 11,
    averageRating: 4.6,
    reviews: [
      { authorName: 'Kevin T.', rating: 5, body: 'James installed hardwood throughout our entire main floor. Looks incredible — perfectly matched to our existing staircase.' },
      { authorName: 'Megan R.', rating: 4, body: 'Great tile work in our master bath. Took a little longer than quoted but quality was excellent.' },
      { authorName: 'Chris A.', rating: 5, body: 'LVP throughout our rental unit. Fast, durable, and great pricing on the material.' },
    ],
  },
];

async function main() {
  console.log('🌱 Seeding database…');

  const pw = await bcrypt.hash('Password123!', 10);

  for (const biz of businesses) {
    const { reviews, isPromoted = false, averageRating, portfolio = [], profileViews = 0, ...bizData } = biz;

    const reviewCount = reviews.length;
    const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviewCount;

    const user = await prisma.user.upsert({
      where: { email: biz.email },
      update: {},
      create: {
        email: biz.email,
        passwordHash: pw,
        name: biz.name,
        role: 'BUSINESS',
        business: {
          create: {
            companyName: bizData.companyName,
            description: bizData.description,
            city: bizData.city,
            state: bizData.state,
            zipCode: bizData.zipCode,
            specialties: bizData.specialties,
            yearsInBusiness: bizData.yearsInBusiness,
            website: bizData.website ?? null,
            isPromoted,
            promotedUntil: isPromoted ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
            averageRating: parseFloat(avgRating.toFixed(1)),
            reviewCount,
            reviews: {
              create: reviews.map(r => ({
                authorName: r.authorName,
                rating: r.rating,
                body: r.body,
              })),
            },
          },
        },
      },
    });

    // Idempotently backfill profileViews + portfolio (upsert above skips updates).
    const business = await prisma.business.findUnique({
      where: { userId: user.id },
      include: { portfolio: true },
    });
    if (business) {
      if (business.profileViews !== profileViews) {
        await prisma.business.update({ where: { id: business.id }, data: { profileViews } });
      }
      if (business.portfolio.length === 0 && portfolio.length > 0) {
        await prisma.portfolioProject.createMany({
          data: portfolio.map(p => ({ ...p, businessId: business.id })),
        });
      }
    }

    console.log(`  ✅ ${bizData.companyName}`);
  }

  console.log(`\n✨ Done — seeded ${businesses.length} contractors.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
