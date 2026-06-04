const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

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
const adminRoutes = require('./routes/admin');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));

// Stripe webhooks need raw body — mount before json parser
app.use('/webhooks', webhookRoutes);

app.use(express.json({ limit: '10mb' }));

// Locally-stored uploads (avatars, portfolio photos) when S3 isn't in use.
// Mounted before the rate limiter so loading images doesn't burn the quota.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

app.use('/auth', authRoutes);
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
app.use('/admin', adminRoutes);

app.get('/health', (_req, res) => res.json({ ok: true }));

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
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
// Don't bind a port under test — supertest drives the app object directly.
if (process.env.NODE_ENV !== 'test' && require.main === module) {
  app.listen(PORT, () => console.log(`API running on :${PORT}`));
}

module.exports = app;
