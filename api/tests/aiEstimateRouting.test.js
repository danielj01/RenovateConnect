// The photo estimator's NVIDIA-primary/Anthropic-fallback routing. NVIDIA is
// tried first when configured and the image format is one it documents
// support for; a runtime failure (not just an absent key) falls back to
// Anthropic within the same request — unlike chatWithAssistant, which only
// falls back when NVIDIA is unconfigured. That gap is exactly what let the
// NVIDIA_CHAT_MODEL retirement take chat down in production; these tests
// pin that the estimator can't fail the same way.
jest.mock('@anthropic-ai/sdk', () => {
  const mockCreate = jest.fn();
  const ctor = jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } }));
  ctor.__mockCreate = mockCreate;
  return ctor;
});

const Anthropic = require('@anthropic-ai/sdk');
const mockAnthropicCreate = Anthropic.__mockCreate;
const ai = require('../src/services/ai');

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
  mockAnthropicCreate.mockReset();
});

// Real magic-byte prefixes (see tests/aiMediaType.test.js) so mediaTypeFromBase64
// sniffs the format for real rather than trusting a label.
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
const WEBP_B64 = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBP'),
]).toString('base64');

const fakeEstimate = { summary: 'Kitchen refresh', totalLow: 4000, totalHigh: 7000 };

const anthropicResponse = (obj) => ({
  content: [{ text: JSON.stringify(obj) }],
  stop_reason: 'end_turn',
});
const nvidiaFetchOk = (obj) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }] }),
});

describe('estimateRenovationCost routing', () => {
  test('uses NVIDIA when configured and the format is supported; Anthropic is never called', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-fake';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(nvidiaFetchOk(fakeEstimate));

    const result = await ai.estimateRenovationCost({ imageBase64Array: [JPEG_B64], roomType: 'Kitchen' });

    expect(result).toEqual(fakeEstimate);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/chat\/completions$/);
    const body = JSON.parse(init.body);
    expect(body.model).toBe('nvidia/nemotron-nano-12b-v2-vl');
    const userMessage = body.messages.find((m) => m.role === 'user');
    expect(userMessage.content[0]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${JPEG_B64}` },
    });
    expect(userMessage.content[1].type).toBe('text');
  });

  test('falls back to Anthropic when NVIDIA is not configured', async () => {
    delete process.env.NVIDIA_API_KEY;
    mockAnthropicCreate.mockResolvedValueOnce(anthropicResponse(fakeEstimate));
    const fetchMock = jest.spyOn(global, 'fetch');

    const result = await ai.estimateRenovationCost({ imageBase64Array: [JPEG_B64], roomType: 'Kitchen' });

    expect(result).toEqual(fakeEstimate);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
  });

  test('falls back to Anthropic when NVIDIA fails at runtime (e.g. a retired model), not just when unconfigured', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-fake';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 410, json: async () => ({ error: 'model retired' }),
    });
    mockAnthropicCreate.mockResolvedValueOnce(anthropicResponse(fakeEstimate));

    const result = await ai.estimateRenovationCost({ imageBase64Array: [JPEG_B64], roomType: 'Kitchen' });

    expect(result).toEqual(fakeEstimate);
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
  });

  test('a WebP upload skips NVIDIA entirely, even when configured, since it only documents JPEG/PNG support', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-fake';
    const fetchMock = jest.spyOn(global, 'fetch');
    mockAnthropicCreate.mockResolvedValueOnce(anthropicResponse(fakeEstimate));

    const result = await ai.estimateRenovationCost({ imageBase64Array: [WEBP_B64], roomType: 'Kitchen' });

    expect(result).toEqual(fakeEstimate);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
  });

  test('a truncated/unparseable NVIDIA response also falls back to Anthropic', async () => {
    // NVIDIA succeeded as an HTTP call but cut the response short (finish_reason:
    // 'length' with incomplete JSON) — estimateRenovationCost's try/catch is
    // deliberately broad, covering parse failures as well as network/HTTP
    // ones, on the theory that a less-reliable-at-strict-JSON vision model
    // failing to format its output correctly should still resolve via
    // Anthropic rather than dead-end the request. Vision-language models are
    // meaningfully less consistent at this than Claude, so this path matters
    // in practice, not just in theory.
    process.env.NVIDIA_API_KEY = 'nvapi-fake';
    const cutOff = JSON.stringify(fakeEstimate).slice(0, -5);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: cutOff }, finish_reason: 'length' }] }),
    });
    mockAnthropicCreate.mockResolvedValueOnce(anthropicResponse(fakeEstimate));

    const result = await ai.estimateRenovationCost({ imageBase64Array: [JPEG_B64], roomType: 'Kitchen' });

    expect(result).toEqual(fakeEstimate);
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
  });
});
