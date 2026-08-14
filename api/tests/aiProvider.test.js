// Both chat and the photo estimator can run on NVIDIA NIM, but on two
// independently-configured models: chatModel() (DeepSeek-class — text only)
// and visionModel() (image-capable). These tests pin that they stay separate
// so a future "just point everything at chatModel()" change fails here
// instead of silently breaking the estimator in production by handing images
// to a model that can't accept them.
const aiProvider = require('../src/services/aiProvider');

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});

describe('provider configuration', () => {
  test('is unconfigured without an API key (chat falls back to Anthropic)', () => {
    delete process.env.NVIDIA_API_KEY;
    expect(aiProvider.isConfigured()).toBe(false);
  });

  test('is configured once a key is present', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-fake';
    expect(aiProvider.isConfigured()).toBe(true);
  });

  test('base URL defaults to NVIDIA NIM and is overridable', () => {
    delete process.env.NVIDIA_BASE_URL;
    expect(aiProvider.baseUrl()).toBe('https://integrate.api.nvidia.com/v1');
    process.env.NVIDIA_BASE_URL = 'https://example.test/v1/';
    expect(aiProvider.baseUrl()).toBe('https://example.test/v1'); // trailing slash trimmed
  });

  test('model id is overridable', () => {
    process.env.NVIDIA_CHAT_MODEL = 'deepseek-ai/deepseek-r1';
    expect(aiProvider.chatModel()).toBe('deepseek-ai/deepseek-r1');
  });

  test('vision model id defaults to nemotron-nano-12b-v2-vl and is overridable', () => {
    delete process.env.NVIDIA_VISION_MODEL;
    expect(aiProvider.visionModel()).toBe('nvidia/nemotron-nano-12b-v2-vl');
    process.env.NVIDIA_VISION_MODEL = 'meta/llama-3.2-11b-vision-instruct';
    expect(aiProvider.visionModel()).toBe('meta/llama-3.2-11b-vision-instruct');
  });
});

describe('visionCompletion', () => {
  beforeEach(() => { process.env.NVIDIA_API_KEY = 'nvapi-fake'; });

  test('sends image_url content blocks alongside the text prompt and returns { text, truncated }', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"totalLow":100}' }, finish_reason: 'stop' }],
      }),
    });

    const result = await aiProvider.visionCompletion({
      system: 'You are an estimator.',
      imageDataUrls: ['data:image/jpeg;base64,AAAA'],
      prompt: 'Room type: Kitchen.',
    });
    expect(result).toEqual({ text: '{"totalLow":100}', truncated: false });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/chat\/completions$/);
    const body = JSON.parse(init.body);
    expect(body.model).toBe('nvidia/nemotron-nano-12b-v2-vl');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are an estimator.' });
    const userContent = body.messages[1].content;
    expect(userContent[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
    expect(userContent[1]).toEqual({ type: 'text', text: 'Room type: Kitchen.' });
  });

  test('reports truncated: true when finish_reason is length', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"cut' }, finish_reason: 'length' }] }),
    });
    const result = await aiProvider.visionCompletion({ imageDataUrls: ['data:image/jpeg;base64,AAAA'], prompt: 'x' });
    expect(result.truncated).toBe(true);
  });

  test('a provider error becomes a clean 503 and never leaks the response body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({ error: 'model retired' }),
    });
    let err;
    try {
      await aiProvider.visionCompletion({ imageDataUrls: ['data:image/jpeg;base64,AAAA'], prompt: 'x' });
    } catch (e) { err = e; }
    expect(err.status).toBe(503);
    expect(err.expose).toBe(true);
    expect(err.message).not.toMatch(/retired/i);
  });
});

describe('chatCompletion', () => {
  beforeEach(() => { process.env.NVIDIA_API_KEY = 'nvapi-fake'; });

  test('sends the OpenAI wire format and returns the reply text', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Try Peak Renovations.' } }] }),
    });

    const reply = await aiProvider.chatCompletion({
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'Who does kitchens?' }],
    });
    expect(reply).toBe('Try Peak Renovations.');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/chat\/completions$/);
    expect(init.headers.Authorization).toBe('Bearer nvapi-fake');
    const body = JSON.parse(init.body);
    // System is a leading message in the OpenAI format, not a top-level field.
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(body.messages[1].content).toBe('Who does kitchens?');
  });

  test('a provider error becomes a clean 503 and never leaks the response body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ error: 'your credit balance is too low' }),
    });

    let err;
    try {
      await aiProvider.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (e) { err = e; }

    expect(err.status).toBe(503);
    expect(err.expose).toBe(true);
    expect(err.message).not.toMatch(/credit|balance/i);
  });

  test('an unexpected response shape is a 503, not a crash', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(
      aiProvider.chatCompletion({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('chat routing', () => {
  test('chatWithAssistant uses the OpenAI-compatible provider when configured', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-fake';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'routed to nvidia' } }] }),
    });

    // Require after the env is set so the module reads the configured state.
    const ai = require('../src/services/ai');
    const reply = await ai.chatWithAssistant({
      message: 'hello',
      businessSummaries: [
        { companyName: 'Peak', city: 'Austin', state: 'TX', specialties: ['Kitchen'], averageRating: 5 },
      ],
    });
    expect(reply).toBe('routed to nvidia');
  });
});
