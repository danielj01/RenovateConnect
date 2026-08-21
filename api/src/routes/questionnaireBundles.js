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

// Question id -> question definition, so answers can be checked against the
// same config the client rendered (type, allowed options, selection cap).
const questionsById = new Map(
  bundles.flatMap((b) => b.questions.map((q) => [q.id, q])),
);

const textAnswerSchema = z.string().max(200);
const locationAnswerSchema = z.object({
  city: z.string().max(100).optional(),
  state: z.string().max(2).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
}).strict();
const multiAnswerSchema = z.array(z.string().max(200)).max(20);

// zod 3's ZodRecord has no .max(), so the key-count cap is a refinement.
const responsesSchema = z.object({
  answers: z.record(z.string().min(1).max(60), z.unknown())
    .refine((o) => Object.keys(o).length <= 50, { message: 'Too many answers (max 50)' }),
}).strict();

// Validates one answer against its question definition. Returns an error
// string, or null when the answer is acceptable.
function validateAnswer(question, value) {
  if (question.type === 'location') {
    if (!locationAnswerSchema.safeParse(value).success) {
      return 'expected a location object';
    }
    return null;
  }

  if (question.type === 'multi') {
    const parsed = multiAnswerSchema.safeParse(value);
    if (!parsed.success) return 'expected an array of strings';
    if (question.maxSelections != null && parsed.data.length > question.maxSelections) {
      return `select at most ${question.maxSelections}`;
    }
    if (question.options) {
      const bad = parsed.data.filter((v) => !question.options.includes(v));
      if (bad.length) return `not an allowed option: ${bad.join(', ')}`;
    }
    return null;
  }

  // 'single'
  const parsed = textAnswerSchema.safeParse(value);
  if (!parsed.success) return 'expected a string';
  if (question.options && !question.options.includes(parsed.data)) {
    return `not an allowed option: ${parsed.data}`;
  }
  return null;
}

// POST /questionnaire-bundles/responses — CLIENT only; saves answers to user record
router.post('/responses', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { answers } = responsesSchema.parse(req.body);

    const unknown = Object.keys(answers).filter((id) => !questionsById.has(id));
    if (unknown.length) {
      return res.status(400).json({ error: `Unknown question id(s): ${unknown.join(', ')}` });
    }

    for (const [id, value] of Object.entries(answers)) {
      const problem = validateAnswer(questionsById.get(id), value);
      if (problem) {
        return res.status(400).json({ error: `Invalid answer for "${id}": ${problem}` });
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
