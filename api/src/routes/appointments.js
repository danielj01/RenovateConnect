const router = require('express').Router();
const { z } = require('zod');
const db = require('../services/db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { sendPush } = require('../services/push');
const { recordActivity } = require('../services/activity');
const { checkAvailability, availabilityMessage } = require('../services/availability');

// Include shapes shared across responses so both parties see who/what is booked.
const appointmentInclude = {
  business: { select: { id: true, companyName: true, logoUrl: true, city: true } },
  client: { select: { id: true, name: true, avatarUrl: true } },
};

// POST /appointments — a homeowner requests a time with a contractor.
router.post('/', authMiddleware, requireRole('CLIENT'), async (req, res, next) => {
  try {
    const { businessId, scheduledAt, durationMin, note } = z.object({
      businessId: z.string().min(1).max(64),
      scheduledAt: z.coerce.date(),
      durationMin: z.number().int().positive().max(24 * 60).optional(),
      note: z.string().max(1000).optional(),
    }).strict().parse(req.body);

    const business = await db.business.findUnique({ where: { id: businessId } });
    if (!business) return res.status(404).json({ error: 'Not found' });

    // Reject slots that fall outside the contractor's published hours. Skipped
    // automatically when the business hasn't configured any hours.
    const hours = await db.businessHours.findMany({ where: { businessId } });
    const avail = checkAvailability(hours, scheduledAt, durationMin || 60);
    if (!avail.ok) {
      return res.status(422).json({ error: availabilityMessage(avail.reason) });
    }

    const appointment = await db.appointment.create({
      data: {
        clientId: req.user.id,
        businessId,
        scheduledAt,
        ...(durationMin ? { durationMin } : {}),
        ...(note ? { note } : {}),
      },
      include: appointmentInclude,
    });

    // Notify the business owner of the request — fire and forget.
    if (business.userId) {
      const client = await db.user.findUnique({ where: { id: req.user.id }, select: { name: true } });
      const body = `${client?.name || 'A homeowner'} requested a time with you.`;
      sendPush(business.userId, {
        type: 'APPOINTMENT',
        title: 'New appointment request 📅',
        body,
        data: { type: 'appointment', appointmentId: appointment.id },
      }).catch(console.error);
      await recordActivity(business.userId, {
        type: 'APPOINTMENT',
        title: 'New appointment request',
        body,
        data: { appointmentId: appointment.id },
      });
    }

    res.status(201).json(appointment);
  } catch (err) {
    next(err);
  }
});

// GET /appointments — role-scoped list, soonest first.
router.get('/', authMiddleware, async (req, res, next) => {
  try {
    const where = req.user.role === 'CLIENT'
      ? { clientId: req.user.id }
      : { business: { userId: req.user.id } };

    const appointments = await db.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: { scheduledAt: 'asc' },
    });
    res.json(appointments);
  } catch (err) {
    next(err);
  }
});

// PATCH /appointments/:id — business confirms/declines; either party cancels.
router.patch('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { status } = z.object({
      status: z.enum(['CONFIRMED', 'DECLINED', 'CANCELLED']),
    }).strict().parse(req.body);

    const appointment = await db.appointment.findUnique({
      where: { id: req.params.id },
      include: { business: { select: { userId: true, companyName: true } } },
    });
    if (!appointment) return res.status(404).json({ error: 'Not found' });

    const isClient = appointment.clientId === req.user.id;
    const isOwner = appointment.business.userId === req.user.id;
    if (!isClient && !isOwner) return res.status(403).json({ error: 'Forbidden' });

    // Clients may only cancel; businesses may confirm/decline (and cancel).
    if (isClient && !isOwner && status !== 'CANCELLED') {
      return res.status(403).json({ error: 'Clients can only cancel' });
    }

    const updated = await db.appointment.update({
      where: { id: req.params.id },
      data: { status },
      include: appointmentInclude,
    });

    // Notify the other party of the status change — fire and forget.
    const recipientId = isOwner ? appointment.clientId : appointment.business.userId;
    if (recipientId) {
      const verb = { CONFIRMED: 'confirmed', DECLINED: 'declined', CANCELLED: 'cancelled' }[status];
      const actor = isOwner
        ? (appointment.business.companyName || 'The contractor')
        : (await db.user.findUnique({ where: { id: req.user.id }, select: { name: true } }))?.name || 'The homeowner';
      const body = `${actor} ${verb} the appointment.`;
      sendPush(recipientId, {
        type: 'APPOINTMENT',
        title: 'Appointment update',
        body,
        data: { type: 'appointment', appointmentId: updated.id },
      }).catch(console.error);
      await recordActivity(recipientId, {
        type: 'APPOINTMENT',
        title: 'Appointment update',
        body,
        data: { appointmentId: updated.id },
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
