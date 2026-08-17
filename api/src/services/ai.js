const Anthropic = require('@anthropic-ai/sdk');
const { httpError } = require('../utils/httpError');
const aiProvider = require('./aiProvider');

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

// Shared between both providers so a NVIDIA vs. Anthropic estimate never
// drifts in what's asked for — only how the request/response is shaped.
//
// The explicit "do NOT price furniture/decor" block below exists because of a
// real, repeatable failure mode found while evaluating free NVIDIA vision
// models for this feature: given the original, shorter prompt, they'd default
// to appraising whatever objects were visible in the photo (a bed, a wine
// rack, decorative jars) instead of pricing renovation work — a bedroom photo
// came back as "Bed: $500-1000, Fireplace: $500-1000" rather than actual
// contractor-scoped line items. Rewriting the prompt to explicitly redefine
// the task and give negative examples fixed it on every model tested (see the
// NVIDIA_VISION_MODEL comment in render.yaml for the model-selection side of
// this). Kept on the shared prompt rather than an NVIDIA-only branch because
// the extra precision doesn't cost Claude anything and this way both
// providers are held to the same explicit standard.
const ESTIMATE_SYSTEM_PROMPT = `You are a professional renovation contractor with 20 years of experience, estimating the cost to RENOVATE the room in the photo — that is, the labor and materials cost for construction work: painting, flooring installation or replacement, tiling, cabinetry, countertops, fixture replacement, drywall, lighting installation, and similar contractor work.

Do NOT price or list furniture, decor, artwork, rugs, plants, electronics, or any movable/decorative item visible in the photo — those are not renovation costs, even if they're the most visually prominent thing in the image. For example, if you see a bed, sofa, bar stools, a wine rack, decorative jars, a lamp, or a TV, do NOT list them as line items. Only list construction/renovation work.

First silently identify the renovatable surfaces and systems visible (floor, walls, ceiling, cabinetry, countertops, fixtures, tile), then estimate realistic contractor-level costs for renovating them — real material + labor pricing, not retail object prices.

Return a JSON object with this exact shape:
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
Return ONLY the JSON, no prose.`;

// Concrete materials per tier rather than a bare "budget"/"high-end" label —
// the label alone leaves the actual spec to the model's imagination, which is
// the thing we're trying to pin down. Keyed by the same LOW/MEDIUM/HIGH tiers
// used for contractor price level (services/costTier.js) so there's one
// vocabulary across the app.
const FINISH_GUIDANCE = {
  LOW: 'Budget — builder-grade and stock materials: laminate or butcher-block '
    + 'counters, stock cabinets, vinyl or laminate flooring, basic fixtures. '
    + 'Assume the existing layout, plumbing, and electrical stay where they are.',
  MEDIUM: 'Mid-range — quality mid-market materials: quartz counters, '
    + 'semi-custom cabinets, tile or engineered hardwood, name-brand fixtures. '
    + 'Minor layout tweaks are fine, but no structural work.',
  HIGH: 'High-end — premium materials: natural stone counters, custom '
    + 'cabinetry, hardwood or large-format tile, designer fixtures. Layout '
    + 'changes, relocated plumbing, and structural work are in scope.',
};

function estimatePrompt(roomType, description, costTier) {
  const parts = [
    `Room type: ${roomType || 'unknown'}.`,
    `Additional context: ${description || 'none provided'}.`,
  ];

  const guidance = costTier ? FINISH_GUIDANCE[costTier] : null;
  if (guidance) {
    parts.push(
      `Finish level the homeowner is planning for — ${guidance}`,
      'Price to that finish level specifically. Because it is pinned, the '
      + 'largest source of variance in a renovation estimate is already '
      + 'removed: keep the low–high spread tight (the high should land around '
      + '1.3–1.4x the low, not several times it) and do not hedge by spanning '
      + 'other finish levels.',
    );
  }

  return parts.join(' ');
}

// Low-level "find the {...} and parse it" shared by both response parsers
// below. Tolerates a markdown code fence or stray prose around the object.
function extractJsonBetweenBraces(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

// Pull the JSON object out of an Anthropic response. Throws a descriptive
// error when the response was cut off mid-object (stop_reason max_tokens) so
// the route layer logs something actionable instead of a bare SyntaxError.
function parseEstimateJson(response) {
  const raw = response.content[0].text;
  const slice = extractJsonBetweenBraces(raw);
  if (!slice) {
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Estimator response truncated at max_tokens before JSON completed');
    }
    throw new Error('Estimator response contained no JSON object');
  }
  try {
    return JSON.parse(slice);
  } catch (err) {
    if (response.stop_reason === 'max_tokens') {
      throw new Error('Estimator response truncated at max_tokens (invalid JSON)');
    }
    throw err;
  }
}

// Same idea, for the OpenAI-shaped { text, truncated } that aiProvider's
// visionCompletion returns.
function parseEstimateJsonFromText(text, truncated) {
  const slice = extractJsonBetweenBraces(text);
  if (!slice) {
    if (truncated) throw new Error('Estimator response truncated before JSON completed');
    throw new Error('Estimator response contained no JSON object');
  }
  try {
    return JSON.parse(slice);
  } catch (err) {
    if (truncated) throw new Error('Estimator response truncated (invalid JSON)');
    throw err;
  }
}

async function estimateWithAnthropic({ imageBase64Array, mediaTypes, roomType, description, costTier }) {
  const imageContent = imageBase64Array.map((b64, i) => ({
    type: 'image',
    source: { type: 'base64', media_type: mediaTypes[i], data: b64 },
  }));

  const response = await callModel({
    model: MODEL,
    // Detailed estimates (many line items + notes) regularly exceed 1024
    // tokens — at 1024 the JSON was truncated mid-string and JSON.parse threw,
    // 500ing every estimate that ran long.
    max_tokens: 3000,
    system: ESTIMATE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [...imageContent, { type: 'text', text: estimatePrompt(roomType, description, costTier) }],
      },
    ],
  });

  return parseEstimateJson(response);
}

// NVIDIA NIM only documents JPEG/PNG support for the vision model — unlike
// the 4 formats Anthropic accepts (see mediaTypeFromBuffer above), so a
// GIF/WebP upload skips NVIDIA and goes straight to Anthropic rather than
// risking an upstream error on an unsupported format.
const NVIDIA_VISION_SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png']);

async function estimateWithNvidia({ imageBase64Array, mediaTypes, roomType, description, costTier }) {
  const imageDataUrls = imageBase64Array.map((b64, i) => `data:${mediaTypes[i]};base64,${b64}`);
  const { text, truncated } = await aiProvider.visionCompletion({
    system: ESTIMATE_SYSTEM_PROMPT,
    imageDataUrls,
    prompt: estimatePrompt(roomType, description, costTier),
    maxTokens: 3000,
  });
  return parseEstimateJsonFromText(text, truncated);
}

// NVIDIA (free) is primary; Anthropic is a runtime fallback, not just a
// config-time one — if NVIDIA is simply unconfigured OR its call fails for
// any reason (rate limit, format rejection, a retired/renamed model — see the
// NVIDIA_CHAT_MODEL incident in render.yaml's history), this request still
// completes instead of 503ing. chatWithAssistant below only falls back when
// NVIDIA is unconfigured, not on a runtime failure; the estimator gets the
// stronger guarantee because it's the app's core "aha moment" — a homeowner
// hitting a dead end here is a much worse outcome than an extra Anthropic call.
async function estimateRenovationCost({ imageBase64Array, roomType, description, costTier }) {
  const mediaTypes = imageBase64Array.map(mediaTypeFromBase64);
  const nvidiaCompatible = mediaTypes.every((t) => NVIDIA_VISION_SUPPORTED_TYPES.has(t));

  if (aiProvider.isConfigured() && nvidiaCompatible) {
    try {
      return await estimateWithNvidia({ imageBase64Array, mediaTypes, roomType, description, costTier });
    } catch (err) {
      console.error('[ai] NVIDIA vision failed, falling back to Anthropic:', err && err.message);
    }
  }

  return estimateWithAnthropic({ imageBase64Array, mediaTypes, roomType, description, costTier });
}

// The chatbot is pure text, so it can run on any provider. When an
// OpenAI-compatible endpoint is configured (NVIDIA NIM / DeepSeek — see
// services/aiProvider.js) chat routes there; otherwise it falls back to
// Anthropic. The photo estimator above deliberately does NOT get this
// treatment: it is image-in, and DeepSeek-class text models cannot accept
// images at all.
async function chatWithAssistant({ message, businessSummaries, history }) {
  const businessContext = businessSummaries
    .map((b) => `- ${b.companyName} (${b.city}, ${b.state}): specialties: ${b.specialties.join(', ')}. Rating: ${b.averageRating}/5.`)
    .join('\n');

  const messages = [
    ...(history || []),
    { role: 'user', content: message },
  ];

  const system = `You are a helpful assistant for RenovateConnect, a marketplace for home renovation contractors.
Help clients find the right contractor for their project. Be friendly and concise.
Do not use emoji. You may use **bold** for business names, but keep formatting light otherwise.

Available businesses on the platform:
${businessContext}

When recommending businesses, use their exact company name. If no business fits perfectly, say so honestly.`;

  if (aiProvider.isConfigured()) {
    return aiProvider.chatCompletion({ system, messages, maxTokens: 512 });
  }

  const response = await callModel({
    model: MODEL,
    max_tokens: 512,
    system,
    messages,
  });

  return response.content[0].text;
}

module.exports = {
  estimateRenovationCost,
  chatWithAssistant,
  parseEstimateJson,
  parseEstimateJsonFromText,
  mediaTypeFromBase64,
  mediaTypeFromBuffer,
};
