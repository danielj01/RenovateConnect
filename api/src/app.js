// Must be first: initializes Sentry before Express/routes are required so it can
// auto-instrument them. No-op unless SENTRY_DSN is set.
const { Sentry, sentryEnabled } = require('./instrument');

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { globalLimiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const businessRoutes = require('./routes/businesses');
const estimationRoutes = require('./routes/estimations');
const messageRoutes = require('./routes/messages');
const chatRoutes = require('./routes/chat');
const leadRoutes = require('./routes/leads');
const webhookRoutes = require('./routes/webhooks');
const deviceRoutes = require('./routes/devices');
const favoriteRoutes = require('./routes/favorites');
const appointmentRoutes = require('./routes/appointments');
const activityRoutes = require('./routes/activities');
const reviewRoutes = require('./routes/reviews');
const savedSearchRoutes = require('./routes/savedSearches');
const quoteRoutes = require('./routes/quotes');
const paymentRoutes = require('./routes/payments');
const projectRoutes = require('./routes/projects');
const adminRoutes = require('./routes/admin');
const internalRoutes = require('./routes/internal');
const feedRoutes = require('./routes/feed');
const reportRoutes = require('./routes/reports');
const blockRoutes = require('./routes/blocks');
const verificationDocumentsRoutes = require('./routes/verificationDocuments');

const { assertStorageConfigured } = require('./services/storage');

const app = express();

// Behind a single PaaS load balancer in prod — trust one proxy hop so
// rate-limit and req.ip use the real client IP (X-Forwarded-For), not the LB's.
app.set('trust proxy', 1);

app.use(helmet());

// CORS: native iOS app sends no Origin (allowed), browsers must be on the
// allowlist. WEB_ORIGINS is a comma-separated list; defaults cover local dev.
const allowedOrigins = (process.env.WEB_ORIGINS
  || 'http://localhost:3000,http://localhost:3001')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    // No Origin header → native app / curl / server-to-server. Allow.
    // Disallowed browser origins get no CORS headers (browser blocks the read)
    // rather than a thrown 500 — keeps the error log / Sentry clean.
    cb(null, !origin || allowedOrigins.includes(origin));
  },
}));

app.use(morgan('dev'));

// Stripe webhooks need raw body — mount before json parser
app.use('/webhooks', webhookRoutes);

app.use(express.json({ limit: '10mb' }));

// Locally-stored uploads (avatars, portfolio photos) when S3 isn't in use.
// Mounted before the rate limiter so loading images doesn't burn the quota.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Baseline API rate limit (per-user when authed, per-IP otherwise). Stripe
// webhooks are mounted above this so Stripe is never throttled. Stricter
// per-endpoint limiters (auth, AI estimator) layer on top in their routers.
app.use(globalLimiter);

app.use('/auth', authRoutes);
// Mount verification docs BEFORE businessRoutes so /:id/verification-documents
// resolves to the dedicated router instead of falling into a generic handler.
app.use('/businesses/:id/verification-documents', verificationDocumentsRoutes);
app.use('/businesses', businessRoutes);
app.use('/estimations', estimationRoutes);
app.use('/conversations', messageRoutes);
app.use('/chat', chatRoutes);
app.use('/leads', leadRoutes);
app.use('/devices', deviceRoutes);
app.use('/favorites', favoriteRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/activities', activityRoutes);
app.use('/reviews', reviewRoutes);
app.use('/saved-searches', savedSearchRoutes);
app.use('/quotes', quoteRoutes);
app.use('/payments', paymentRoutes);
app.use('/projects', projectRoutes);
app.use('/admin', adminRoutes);
app.use('/internal', internalRoutes);
app.use('/feed', feedRoutes);
app.use('/reports', reportRoutes);
app.use('/blocks', blockRoutes);

app.get('/health', (_req, res) => res.json({ ok: true }));

// Capture unhandled errors in Sentry before our own handler formats the
// response. Only registered when Sentry is configured. We skip client errors
// (Zod validation, explicit 4xx) so the dashboard stays signal, not noise.
if (sentryEnabled) {
  Sentry.setupExpressErrorHandler(app, {
    shouldHandleError(error) {
      if (error && error.name === 'ZodError') return false;
      const status = (error && (error.status || error.statusCode)) || 500;
      return status >= 500;
    },
  });
}

app.use((err, _req, res, _next) => {
  // Zod validation failures are client errors — surface a readable 400 instead
  // of dumping the raw issues array as a 500.
  if (err && err.name === 'ZodError') {
    const issue = Array.isArray(err.issues) ? err.issues[0] : undefined;
    const field = issue && Array.isArray(issue.path) ? issue.path.join('.') : '';
    const message = issue
      ? (field ? `${issue.message} (${field})` : issue.message)
      : 'Invalid request';
    return res.status(400).json({ error: message });
  }
  console.error(err);
  const status = err.status || 500;
  // Client-error messages (4xx) are intentional — surface them. Server errors
  // (5xx) often leak internals: Prisma's `*KnownRequestError.message` includes
  // absolute file paths and source snippets; Stripe/Node errors can echo
  // request bodies. Replace 5xx bodies with a generic message so the client
  // never sees the stack — the real error is in the log + Sentry.
  if (status >= 500) {
    return res.status(status).json({ error: 'Internal server error' });
  }
  res.status(status).json({ error: err.message || 'Request failed' });
});

const PORT = process.env.PORT || 3000;
// Don't bind a port under test — supertest drives the app object directly.
if (process.env.NODE_ENV !== 'test' && require.main === module) {
  // Fail fast in prod if image storage would silently fall back to the
  // ephemeral local disk (uploads vanish on every deploy otherwise).
  assertStorageConfigured();

  app.listen(PORT, () => console.log(`API running on :${PORT}`));

  // Periodically release milestone funds the homeowner left un-actioned past the
  // grace window (protects contractors from being ghosted after submitting work).
  // Lightweight in-process timer — fine for a single API instance. When scaling
  // to multiple instances, disable this and drive POST /internal/sweep from an
  // external cron instead (see routes/internal.js) so it runs exactly once.
  const { autoReleaseStaleMilestones } = projectRoutes;
  const runAutoRelease = () => autoReleaseStaleMilestones()
    .then((n) => { if (n) console.log(`Auto-released ${n} milestone(s)`); })
    .catch((err) => console.error('Auto-release sweep failed', err));
  setInterval(runAutoRelease, 6 * 60 * 60 * 1000).unref(); // every 6h
  runAutoRelease();
}

module.exports = app;
