// Sentry initialization. Required at the very top of app.js — before Express and
// the route modules — so Sentry can auto-instrument them.
//
// No-op when SENTRY_DSN is unset (local dev, CI, tests): init is skipped, so
// nothing is sent and there's no behavior change. Set SENTRY_DSN in prod (and
// optionally staging) to start capturing unhandled errors.
const Sentry = require('@sentry/node');

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    // Tracing is opt-in and off by default (0) to avoid surprise quota/cost;
    // bump SENTRY_TRACES_SAMPLE_RATE (e.g. 0.1) when you want performance data.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
  });
}

module.exports = { Sentry, sentryEnabled: Boolean(dsn) };
