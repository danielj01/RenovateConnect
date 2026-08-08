// OpenAI-compatible chat-completions client.
//
// NVIDIA NIM (https://integrate.api.nvidia.com/v1) speaks the OpenAI wire
// format, as do most self-hosted and third-party inference endpoints, so one
// small fetch-based client covers all of them. Written with fetch rather than
// the openai SDK to match how email.js and googleAuth.js hand-roll their HTTP —
// no new dependency for one endpoint.
//
// This is the TEXT path only. Vision stays on Anthropic (services/ai.js):
// DeepSeek and most NIM-hosted text models cannot accept image input at all,
// and the photo estimator is image-in by definition.

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
async function chatCompletion({ system, messages, maxTokens = 512 }) {
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: chatModel(),
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages,
      ],
    }),
  });

  if (!res.ok) {
    // Never surface the provider's response body — it can echo the request and,
    // on some providers, billing details. Log the status; return a safe 503.
    console.error(`[aiProvider] ${chatModel()} responded ${res.status}`);
    throw httpError(503, 'This feature is temporarily unavailable. Please try again in a bit.');
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw httpError(503, 'This feature is temporarily unavailable. Please try again in a bit.');
  }

  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    console.error('[aiProvider] unexpected response shape (no choices[0].message.content)');
    throw httpError(503, 'This feature is temporarily unavailable. Please try again in a bit.');
  }
  return text;
}

module.exports = { isConfigured, chatCompletion, chatModel, baseUrl };
