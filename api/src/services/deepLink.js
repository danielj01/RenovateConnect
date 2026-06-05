// Canonical deep-link resolution for activity-feed entries and push payloads.
//
// Different notification types stash different id keys in their `data` blob
// (conversationId, appointmentId, quoteId, businessId, …). Rather than make the
// client sniff every optional key, we resolve a single normalized link
// descriptor — { screen, id } — that the app can route on directly.
//
// `screen` is one of: 'conversation' | 'appointment' | 'quote' | 'business' |
// 'review'. Returns null when nothing actionable can be linked.
function deepLinkFor(type, data) {
  const d = data || {};
  switch (type) {
    case 'MESSAGE':
    case 'LEAD':
      // Leads come from either a first message (conversation) or a quote request.
      if (d.conversationId) return { screen: 'conversation', id: d.conversationId };
      if (d.quoteId) return { screen: 'quote', id: d.quoteId };
      return d.businessId ? { screen: 'business', id: d.businessId } : null;
    case 'APPOINTMENT':
      return d.appointmentId ? { screen: 'appointment', id: d.appointmentId } : null;
    case 'REVIEW':
      // The post-release nudge opens the review composer directly; a new review
      // or a business reply just point at the business profile.
      if (d.prompt === 'review' && d.businessId) return { screen: 'review', id: d.businessId };
      return d.businessId ? { screen: 'business', id: d.businessId } : null;
    case 'SAVED_SEARCH':
      return d.businessId ? { screen: 'business', id: d.businessId } : null;
    case 'PAYMENT':
      // Deposit/refund events point at the originating quote, falling back to
      // the contractor's profile.
      if (d.quoteId) return { screen: 'quote', id: d.quoteId };
      return d.businessId ? { screen: 'business', id: d.businessId } : null;
    default:
      return null;
  }
}

module.exports = { deepLinkFor };
