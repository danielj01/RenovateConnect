// OpenAI-compatible chat-completions client.
//
// NVIDIA NIM (https://integrate.api.nvidia.com/v1) speaks the OpenAI wire
// format, as do most self-hosted and third-party inference endpoints, so one
// small fetch-based client covers all of them. Written with fetch rather than
// the openai SDK to match how email.js and googleAuth.js hand-roll their HTTP —
// no new dependency for one endpoint.
//
// Two independently-configurable models: chatModel() (text-only — DeepSeek-class
// models have no vision capability) and visionModel() (image-in, used by the
// photo estimator in services/ai.js). They're separate env vars because a
// text-only default (chatModel) would silently break vision if the two were
// ever conflated.

const { httpError } = require('../utils/httpError');

const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';

function baseUrl() {
  return (process.env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

// The text provider is considered configured only when a key is present.
// Without it, services/ai.js falls back to Anthropic for chat.
function isConfigured() {
  return Boolean(process.env.NVIDIA_API_KEY);
}

// Model id as it appears in the provider's catalog, e.g.
// "deepseek-ai/deepseek-v3.1". Check your NVIDIA dashboard for the exact
// string — NIM model ids are namespaced and change between releases.
function chatModel() {
  return process.env.NVIDIA_CHAT_MODEL || 'deepseek-ai/deepseek-v3.1';
}

// One chat completion. `system` is sent as a leading system message, which is
// how the OpenAI format carries it (Anthropic takes it as a top-level field —
// that difference is why this lives behind its own function).
async function chatCompletion(options) {
  const models = [...new Set([chatModel(), process.env.NVIDIA_CHAT_FALLBACK_MODEL].filter(Boolean))];
  for (let i = 0; i < models.length; i++) {
    try {
      return await chatCompletionAttempt({ ...options, model: models[i] });
    } catch (err) {
      if (!err.retryable || i === models.length - 1) {
        throw httpError(503, 'The AI assistant is busy right now. Please try again shortly.');
      }
      console.warn('[aiProvider] chat model unavailable; trying configured backup');
    }
  }
}

async function chatCompletionAttempt({ system, messages, maxTokens = 512, model }) {
  let res;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      ...(['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nvidia/nemotron-3.5-lightning-30b-a3b'].includes(model)
        ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages,
      ],
    }),
  });

  } catch {
    throw Object.assign(new Error('AI provider connection failed'), { retryable: true });
  }

  if (!res.ok) {
    // Never surface the provider's response body — it can echo the request and,
    // on some providers, billing details. Log the status; return a safe 503.
    console.error(`[aiProvider] ${model} responded ${res.status}`);
    throw Object.assign(new Error('AI provider request failed'), { retryable: [404, 408, 410, 429].includes(res.status) || res.status >= 500 });
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw httpError(503, 'This feature is temporarily unavailable. Please try again in a bit.');
  }

  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    console.error('[aiProvider] unexpected response shape (no choices[0].message.content)');
    throw httpError(503, 'This feature is temporarily unavailable. Please try again in a bit.');
  }
  return text;
}

// Current hosted vision model. The former Nano 12B V2 VL endpoint was
// retired by NVIDIA on August 26, 2026 (HTTP 410).
function visionModel() {
  return process.env.NVIDIA_VISION_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning';
}

// One vision completion. `imageDataUrls` are full `data:<mime>;base64,<...>`
// strings (not bare base64) — that's the format the image_url block expects.
// Returns { text, truncated } rather than throwing on a cut-off response, so
// the caller (services/ai.js) can produce the same descriptive
// truncated-mid-JSON error it already gives for the Anthropic path.
async function visionCompletion({ system, imageDataUrls, prompt, maxTokens = 3000 }) {
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(45000),
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: visionModel(),
      ...(visionModel() === 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
        ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        {
          role: 'user',
          content: [
            ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    console.error(`[aiProvider] ${visionModel()} responded ${res.status}`);
    throw httpError(503, 'This feature is temporarily unavailable. Please try again in a bit.');
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw httpError(503, 'This feature is temporarily unavailable. Please try again in a bit.');
  }

  const choice = body?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== 'string') {
    console.error('[aiProvider] vision: unexpected response shape (no choices[0].message.content)');
    throw httpError(503, 'This feature is temporarily unavailable. Please try again in a bit.');
  }
  return { text, truncated: choice?.finish_reason === 'length' };
}

module.exports = { isConfigured, chatCompletion, chatModel, visionModel, visionCompletion, baseUrl };
