const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const bundles = require('../config/questionnaire-bundles');

// GET /questionnaire-bundles — public; returns only enabled bundles
router.get('/', async (_req, res, next) => {
  try {
    const enabled = bundles.filter((b) => b.enabled);
    res.json(enabled);
  } catch (err) {
    next(err);
  }
});

// Build a set of ids whose type is 'multi' so we can enforce array vs scalar
const multiQuestionIds = new Set(
  bundles.flatMap((b) => b.questions.filter((q) => q.type === 'multi').map((q) => q.id)),
);

const singleAnswerSchema = z.union([
  z.string().max(200),
  // location answer shape
  z.object({
    city: z.string().max(100).optional(),
    state: z.string().max(2).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  }).strict(),
]);

const multiAnswerSchema = z.array(z.string().max(200)).max(20);

const responsesSchema = z.object({
  answers: z.record(z.string().min(1).max(60), z.unknown()).max(50),
}).strict();

// POST /questionnaire-bundles/responses — CLIENT only; saves answers to user record
router.post('/responses', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { answers } = responsesSchema.parse(req.body);

    const validIds = new Set(bundles.flatMap((b) => b.questions.map((q) => q.id)));
    const unknown = Object.keys(answers).filter((id) => !validIds.has(id));
    if (unknown.length) {
      return res.status(400).json({ error: `Unknown question id(s): ${unknown.join(', ')}` });
    }

    for (const [id, value] of Object.entries(answers)) {
      const schema = multiQuestionIds.has(id) ? multiAnswerSchema : singleAnswerSchema;
      const result = schema.safeParse(value);
      if (!result.success) {
        return res.status(400).json({
          error: `Invalid answer for "${id}": ${result.error.issues[0]?.message ?? 'invalid value'}`,
        });
      }
    }

    const user = await db.user.update({
      where: { id: req.user.id },
      data: {
        questionnaireCompleted: true,
        questionnairePreferences: answers,
      },
      select: {
        id: true,
        questionnaireCompleted: true,
        questionnairePreferences: true,
      },
    });

    res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
