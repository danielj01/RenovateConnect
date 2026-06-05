const { deepLinkFor } = require('../src/services/deepLink');

describe('deepLinkFor (unit)', () => {
  test('MESSAGE → conversation', () => {
    expect(deepLinkFor('MESSAGE', { conversationId: 'c1' }))
      .toEqual({ screen: 'conversation', id: 'c1' });
  });

  test('LEAD from a conversation → conversation', () => {
    expect(deepLinkFor('LEAD', { conversationId: 'c2' }))
      .toEqual({ screen: 'conversation', id: 'c2' });
  });

  test('LEAD from a quote request → quote', () => {
    expect(deepLinkFor('LEAD', { quoteId: 'q1' }))
      .toEqual({ screen: 'quote', id: 'q1' });
  });

  test('LEAD prefers conversation over quote when both present', () => {
    expect(deepLinkFor('LEAD', { conversationId: 'c3', quoteId: 'q3' }))
      .toEqual({ screen: 'conversation', id: 'c3' });
  });

  test('APPOINTMENT → appointment', () => {
    expect(deepLinkFor('APPOINTMENT', { appointmentId: 'a1' }))
      .toEqual({ screen: 'appointment', id: 'a1' });
  });

  test('REVIEW → business', () => {
    expect(deepLinkFor('REVIEW', { businessId: 'b1' }))
      .toEqual({ screen: 'business', id: 'b1' });
  });

  test('REVIEW nudge (prompt) → review composer', () => {
    expect(deepLinkFor('REVIEW', { businessId: 'b1', prompt: 'review', projectId: 'p1' }))
      .toEqual({ screen: 'review', id: 'b1' });
  });

  test('SAVED_SEARCH → business', () => {
    expect(deepLinkFor('SAVED_SEARCH', { businessId: 'b2', savedSearchId: 's1' }))
      .toEqual({ screen: 'business', id: 'b2' });
  });

  test('PAYMENT prefers the quote, falling back to business', () => {
    expect(deepLinkFor('PAYMENT', { quoteId: 'q9', businessId: 'b9' }))
      .toEqual({ screen: 'quote', id: 'q9' });
    expect(deepLinkFor('PAYMENT', { businessId: 'b9' }))
      .toEqual({ screen: 'business', id: 'b9' });
    expect(deepLinkFor('PAYMENT', {})).toBeNull();
  });

  test('missing ids resolve to null', () => {
    expect(deepLinkFor('APPOINTMENT', {})).toBeNull();
    expect(deepLinkFor('MESSAGE', {})).toBeNull();
    expect(deepLinkFor('SAVED_SEARCH', undefined)).toBeNull();
  });

  test('unknown types resolve to null', () => {
    expect(deepLinkFor('SOMETHING_ELSE', { conversationId: 'c' })).toBeNull();
  });
});
