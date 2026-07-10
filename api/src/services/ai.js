const Anthropic = require('@anthropic-ai/sdk');
const { httpError } = require('../utils/httpError');

const client = new Anthropic();
const MODEL = 'claude-opus-4-7';

// Anthropic's vision API accepts jpeg, png, gif, and webp — NOT heic. Detect
// the real media type from the image bytes so we send the correct one instead
// of a hardcoded value (the old hardcoded 'image/jpeg' made PNG screenshots
// and other formats fail with an upstream 400). HEIC (the default iPhone
// camera format) and anything unrecognized are rejected with a clear,
// client-safe 415 rather than a cryptic provider error.
function mediaTypeFromBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  // ISO-BMFF (HEIC/HEIF): "....ftyp<brand>" — call it out by name so the user
  // knows to switch formats.
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'heif'].includes(brand)) {
      throw httpError(415, 'That photo is in a format we can’t read yet (HEIC). Please upload a JPEG or PNG.');
    }
  }
  throw httpError(415, 'Unsupported image format. Please upload a JPEG or PNG photo.');
}

// The callers hand us base64; decode a small prefix (enough for the magic
// bytes) to sniff the type without materializing the whole image twice.
function mediaTypeFromBase64(b64) {
  const prefix = Buffer.from(String(b64).slice(0, 24), 'base64');
  return mediaTypeFromBuffer(prefix);
}

// Map any provider/network failure to a clean, client-safe 503. Critically,
// this stops the Anthropic SDK's own error message (which can include billing
// details like "your credit balance is too low") from ever reaching a user.
async function callModel(params) {
  try {
    return await client.messages.create(params);
  } catch (err) {
    console.error('[ai] model call failed:', err && err.message);
    throw httpError(503, 'This feature is temporarily unavailable. Please try again in a bit.');
  }
}

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
    source: { type: 'base64', media_type: mediaTypeFromBase64(b64), data: b64 },
  }));

  const response = await callModel({
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

  const response = await callModel({
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

module.exports = {
  estimateRenovationCost,
  chatWithAssistant,
  parseEstimateJson,
  mediaTypeFromBase64,
  mediaTypeFromBuffer,
};
