// Detect which on-platform businesses the AI assistant named in its reply, so
// the client can render tappable "View {company}" deep links. The system prompt
// instructs the model to use exact company names, so a case-insensitive
// substring match is deterministic and cheap (no second model round-trip).
function extractMentions(reply, businesses) {
  if (!reply || !Array.isArray(businesses)) return [];
  const lower = reply.toLowerCase();
  const seen = new Set();
  const out = [];
  for (const b of businesses) {
    const name = b.companyName;
    if (!name) continue;
    if (lower.includes(name.toLowerCase()) && !seen.has(b.id)) {
      seen.add(b.id);
      out.push({ id: b.id, companyName: name });
    }
  }
  return out;
}

module.exports = { extractMentions };
