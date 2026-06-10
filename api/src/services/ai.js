const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();
const MODEL = 'claude-opus-4-7';

// Pull the JSON object out of a model response. Tolerates a markdown code
// fence or stray prose around the object; throws a descriptive error when the
// response was cut off mid-object (stop_reason max_tokens) so the route layer
// logs something actionable instead of a bare SyntaxError.
function parseEstimateJson(response) {
  const raw = response.content[0].text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Estimator response truncated at max_tokens before JSON completed');
    }
    throw new Error('Estimator response contained no JSON object');
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Estimator response truncated at max_tokens (invalid JSON)');
    }
    throw err;
  }
}

async function estimateRenovationCost({ imageBase64Array, roomType, description }) {
  const imageContent = imageBase64Array.map((b64) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
  }));

  const response = await client.messages.create({
    model: MODEL,
    // Detailed estimates (many line items + notes) regularly exceed 1024
    // tokens — at 1024 the JSON was truncated mid-string and JSON.parse threw,
    // 500ing every estimate that ran long.
    max_tokens: 3000,
    system: `You are a professional renovation cost estimator with 20 years of experience.
Analyze the provided photos and return a JSON object with this exact shape:
{
  "summary": "brief description of what you see",
  "lineItems": [
    { "item": "name", "low": 1000, "high": 2000, "unit": "lump sum" }
  ],
  "totalLow": 5000,
  "totalHigh": 10000,
  "currency": "USD",
  "confidence": "low|medium|high",
  "notes": "any caveats or assumptions"
}
Return ONLY the JSON, no prose.`,
    messages: [
      {
        role: 'user',
        content: [
          ...imageContent,
          {
            type: 'text',
            text: `Room type: ${roomType || 'unknown'}. Additional context: ${description || 'none provided'}.`,
          },
        ],
      },
    ],
  });

  return parseEstimateJson(response);
}

async function chatWithAssistant({ message, businessSummaries, history }) {
  const businessContext = businessSummaries
    .map((b) => `- ${b.companyName} (${b.city}, ${b.state}): specialties: ${b.specialties.join(', ')}. Rating: ${b.averageRating}/5.`)
    .join('\n');

  const messages = [
    ...(history || []),
    { role: 'user', content: message },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: `You are a helpful assistant for RenovateConnect, a marketplace for home renovation contractors.
Help clients find the right contractor for their project. Be friendly and concise.

Available businesses on the platform:
${businessContext}

When recommending businesses, use their exact company name. If no business fits perfectly, say so honestly.`,
    messages,
  });

  return response.content[0].text;
}

module.exports = { estimateRenovationCost, chatWithAssistant, parseEstimateJson };
