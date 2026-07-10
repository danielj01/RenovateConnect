// Build an Error whose message IS meant to reach the client. The global error
// handler (app.js) only echoes `err.message` when `expose === true`; every
// other error gets a generic message by status class, so third-party SDK
// errors (Anthropic/Stripe) and Prisma internals can never leak.
//
// Use this for the handful of thrown (rather than res.status(...)-returned)
// client-facing errors — e.g. mapping an upstream outage to a clean 503.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

module.exports = { httpError };
