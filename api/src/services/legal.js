// Single source of truth for the current legal-document versions.
//
// Bump CURRENT_TERMS_VERSION whenever the Terms of Service materially change,
// and keep it equal to the "Last updated" date shown on the web Terms page
// (web/app/terms/page.tsx). Users whose recorded `termsVersion` is older than
// this are considered to need re-acceptance, so the app can re-prompt them —
// this is what keeps a continuous, provable chain of assent to the current
// terms (important for arbitration / class-waiver enforceability).
const CURRENT_TERMS_VERSION = '2026-06-26';

module.exports = { CURRENT_TERMS_VERSION };
