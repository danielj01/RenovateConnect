const express = require('express');
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
const advertisingRoutes = require('./routes/advertising');
const webhookRoutes = require('./routes/webhooks');

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));

// Stripe webhooks need raw body — mount before json parser
app.use('/webhooks', webhookRoutes);

app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

app.use('/auth', authRoutes);
app.use('/businesses', businessRoutes);
app.use('/estimations', estimationRoutes);
app.use('/conversations', messageRoutes);
app.use('/chat', chatRoutes);
app.use('/leads', leadRoutes);
app.use('/advertising', advertisingRoutes);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on :${PORT}`));

module.exports = app;
