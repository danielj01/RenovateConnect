const { extractMentions } = require('../src/utils/mentions');

const businesses = [
  { id: 'b1', companyName: 'Alpha Build' },
  { id: 'b2', companyName: 'Beta Renovations' },
  { id: 'b3', companyName: 'Gamma Roofing' },
];

describe('extractMentions', () => {
  test('matches a single named business', () => {
    const out = extractMentions('I recommend Alpha Build for your kitchen.', businesses);
    expect(out).toEqual([{ id: 'b1', companyName: 'Alpha Build' }]);
  });

  test('matches multiple businesses in order of the list', () => {
    const reply = 'You could try Beta Renovations or Alpha Build.';
    const out = extractMentions(reply, businesses);
    expect(out).toEqual([
      { id: 'b1', companyName: 'Alpha Build' },
      { id: 'b2', companyName: 'Beta Renovations' },
    ]);
  });

  test('is case-insensitive', () => {
    const out = extractMentions('check out alpha build', businesses);
    expect(out).toEqual([{ id: 'b1', companyName: 'Alpha Build' }]);
  });

  test('does not duplicate a business named twice', () => {
    const out = extractMentions('Alpha Build is great. Did I mention Alpha Build?', businesses);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('b1');
  });

  test('returns empty when no business is named', () => {
    expect(extractMentions('No good fit on the platform yet.', businesses)).toEqual([]);
  });

  test('handles empty / missing input gracefully', () => {
    expect(extractMentions('', businesses)).toEqual([]);
    expect(extractMentions(null, businesses)).toEqual([]);
    expect(extractMentions('Alpha Build', null)).toEqual([]);
    expect(extractMentions('Alpha Build', undefined)).toEqual([]);
  });

  test('ignores businesses with no companyName', () => {
    const out = extractMentions('Alpha Build and nothing else', [{ id: 'x', companyName: null }, ...businesses]);
    expect(out).toEqual([{ id: 'b1', companyName: 'Alpha Build' }]);
  });
});
