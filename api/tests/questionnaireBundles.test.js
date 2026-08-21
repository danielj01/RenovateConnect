const request = require('supertest');
const app = require('../src/app');
const { db, resetDb, createClient, createBusiness } = require('./helpers');

beforeEach(resetDb);
afterAll(async () => { await db.$disconnect(); });

describe('GET /questionnaire-bundles', () => {
  test('returns only enabled bundles', async () => {
    const res = await request(app).get('/questionnaire-bundles');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach((b) => expect(b.enabled).toBe(true));
  });

  test('each bundle has id, name, and questions array', async () => {
    const res = await request(app).get('/questionnaire-bundles');
    expect(res.status).toBe(200);
    res.body.forEach((b) => {
      expect(typeof b.id).toBe('string');
      expect(typeof b.name).toBe('string');
      expect(Array.isArray(b.questions)).toBe(true);
    });
  });

  test('questions carry expected fields', async () => {
    const res = await request(app).get('/questionnaire-bundles');
    const allQuestions = res.body.flatMap((b) => b.questions);
    expect(allQuestions.length).toBeGreaterThan(0);
    allQuestions.forEach((q) => {
      expect(typeof q.id).toBe('string');
      expect(typeof q.prompt).toBe('string');
      expect(['single', 'multi', 'location']).toContain(q.type);
      expect(typeof q.sortByConversions).toBe('boolean');
    });
  });

  test('accessible without authentication', async () => {
    const res = await request(app).get('/questionnaire-bundles');
    expect(res.status).toBe(200);
  });
});

describe('POST /questionnaire-bundles/responses — auth', () => {
  test('requires authentication', async () => {
    const res = await request(app)
      .post('/questionnaire-bundles/responses')
      .send({ answers: { specialty: 'Kitchen' } });
    expect(res.status).toBe(401);
  });

  test('rejects BUSINESS role', async () => {
    const { token } = await createBusiness();
    const res = await request(app)
      .post('/questionnaire-bundles/responses')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: { specialty: 'Kitchen' } });
    expect(res.status).toBe(403);
  });
});

describe('POST /questionnaire-bundles/responses — happy path', () => {
  test('saves answers and marks questionnaireCompleted', async () => {
    const { user, token } = await createClient();
    const answers = {
      specialty: 'Kitchen',
      constructionType: 'Existing property',
      scope: 'Full renovation',
      budget: '$20k–$50k',
      priorities: ['Top Rated', 'Most Experienced'],
      timeline: 'Within a month',
    };
    const res = await request(app)
      .post('/questionnaire-bundles/responses')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers });

    expect(res.status).toBe(200);
    expect(res.body.questionnaireCompleted).toBe(true);
    expect(res.body.questionnairePreferences).toMatchObject({ specialty: 'Kitchen' });

    const stored = await db.user.findUnique({ where: { id: user.id } });
    expect(stored.questionnaireCompleted).toBe(true);
    expect(stored.questionnairePreferences.specialty).toBe('Kitchen');
  });

  test('accepts a location object answer', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/questionnaire-bundles/responses')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: { location: { city: 'Austin', state: 'TX', lat: 30.27, lng: -97.74 } } });

    expect(res.status).toBe(200);
    expect(res.body.questionnairePreferences.location.city).toBe('Austin');
  });

  test('accepts an empty answers object', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/questionnaire-bundles/responses')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: {} });

    expect(res.status).toBe(200);
    expect(res.body.questionnaireCompleted).toBe(true);
  });
});

describe('POST /questionnaire-bundles/responses — validation', () => {
  test('rejects unknown question id', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/questionnaire-bundles/responses')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: { notARealQuestion: 'value' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/notARealQuestion/);
  });

  test('rejects string value for a multi question', async () => {
    const { token } = await createClient();
    // 'priorities' is type:multi — must be an array, not a string
    const res = await request(app)
      .post('/questionnaire-bundles/responses')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: { priorities: 'Top Rated' } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/priorities/);
  });

  test('rejects array value for a single question', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/questionnaire-bundles/responses')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: { specialty: ['Kitchen', 'Bathroom'] } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/specialty/);
  });

  test('rejects missing answers field', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/questionnaire-bundles/responses')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('rejects extra top-level fields', async () => {
    const { token } = await createClient();
    const res = await request(app)
      .post('/questionnaire-bundles/responses')
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: {}, extraField: true });

    expect(res.status).toBe(400);
  });
});
