// parseEstimateJson — the guard between Claude's text output and JSON.parse.
// Regression for the prod bug where a long estimate hit max_tokens: 1024, the
// JSON was cut mid-string, and every long estimate 500ed.
const { parseEstimateJson } = require('../src/services/ai');

const goodObject = { summary: 'x', totalLow: 1, totalHigh: 2 };
const goodJson = JSON.stringify(goodObject);

function resp(text, stopReason = 'end_turn') {
  return { content: [{ text }], stop_reason: stopReason };
}

describe('parseEstimateJson', () => {
  test('parses a clean JSON response', () => {
    expect(parseEstimateJson(resp(goodJson))).toEqual(goodObject);
  });

  test('parses JSON wrapped in a markdown code fence', () => {
    expect(parseEstimateJson(resp('```json\n' + goodJson + '\n```'))).toEqual(goodObject);
  });

  test('parses JSON surrounded by stray prose', () => {
    expect(parseEstimateJson(resp(`Here is the estimate:\n${goodJson}\nLet me know!`)))
      .toEqual(goodObject);
  });

  test('truncated-at-max_tokens response throws a descriptive error, not a bare SyntaxError', () => {
    const truncated = goodJson.slice(0, goodJson.length - 5); // cut mid-object
    expect(() => parseEstimateJson(resp(truncated, 'max_tokens')))
      .toThrow(/truncated at max_tokens/);
  });

  test('a response with no JSON at all throws a descriptive error', () => {
    expect(() => parseEstimateJson(resp('I cannot analyze this image.')))
      .toThrow(/no JSON object/);
  });
});
