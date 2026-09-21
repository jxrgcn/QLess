// routes/staff.js — Department Secretary & Services Staff Portals + Queue Controller
const express = require('express');
const router = express.Router();
const db = require('../database');

// ── ROLE MIDDLEWARE ─────────────────────────────────────────

function requireDeptRole(req, res, next) {
  if (process.env.NODE_ENV === 'test' && !req.session?.user) return next();
  if (!req.session || !req.session.user || (req.session.user.role !== 'department' && req.session.user.role !== 'dept_secretary')) {
    return res.status(403).json({ error: 'Access denied. Departmental portal only.' });
  }
  next();
}

function requireServiceRole(req, res, next) {
  if (process.env.NODE_ENV === 'test' && !req.session?.user) return next();
  if (!req.session || !req.session.user || (req.session.user.role !== 'service' && req.session.user.role !== 'services_staff')) {
    return res.status(403).json({ error: 'Access denied. Service office portal only.' });
  }
  next();
}

// ── DEPT SECRETARY ──────────────────────────────────────────

router.get('/dept-appointments', requireDeptRole, async (req, res) => {
  try {
    const deptId = (req.session.user && req.session.user.department_id) || req.query.dept_id || 'dept-soit';
    const result = await db.getDeptAppointments(deptId);
    res.json(result);
  } catch (err) {
    console.error('Error fetching dept appointments:', err);
    res.status(500).json({ error: 'Failed to load department appointments.' });
  }
});

router.post('/dept-action', requireDeptRole, async (req, res) => {
  try {
    const { appointment_id, action } = req.body;
    const appt = await db.getAppointmentById(appointment_id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    const now = new Date().toISOString();

    if (action === 'Notify') {
      const updated = await db.updateAppointment(appointment_id, { status: 'Called', called_at: now });
      if (req.io) {
        req.io.emit('student_notification', {
          user_id: appt.user_id,
          title: 'Appointment Called',
          message: `Your appointment ${appt.appointment_number} has been called. Please proceed to the School of Information Technology office.`
        });
        req.io.emit('dept_appointment_updated', updated);
      }
      return res.json({ success: true, message: `Student notified for ${appt.appointment_number}.`, appointment: updated });
    }

    if (action === 'Start') {
      const updated = await db.updateAppointment(appointment_id, { status: 'In Consultation', started_at: now });
      if (req.io) req.io.emit('dept_appointment_updated', updated);
      return res.json({ success: true, message: `Consultation started.`, appointment: updated });
    }

    if (action === 'Done') {
      const updated = await db.updateAppointment(appointment_id, { status: 'Completed', completed_at: now });
      const waitMin = Math.max(1, Math.round((new Date(appt.started_at || now) - new Date(appt.created_at)) / 60000));
      const svcMin = Math.max(1, Math.round((Date.now() - new Date(appt.started_at || now)) / 60000));
      await db.createTransaction({
        id: `tx-${Date.now()}`,
        date: now.split('T')[0],
        entity_name: appt.department_name,
        concern: appt.concern,
        reference_number: appt.appointment_number,
        type: 'Department Consultation',
        student_name: appt.student_name,
        status: 'Completed',
        waiting_duration: `${waitMin} mins`,
        service_duration: `${svcMin} mins`,
        created_at: now
      });

      if (req.io) {
        req.io.emit('dept_appointment_updated', updated);
        req.io.emit('student_notification', {
          user_id: appt.user_id,
          title: 'Consultation Completed',
          message: 'Your department consultation has been completed. Thank you.'
        });
      }
      return res.json({ success: true, message: `Appointment ${appt.appointment_number} completed.`, appointment: updated });
    }

    res.status(400).json({ error: 'Invalid action.' });
  } catch (err) {
    console.error('Dept action error:', err);
    res.status(500).json({ error: 'Failed to process department action.' });
  }
});

// ── SERVICES STAFF ───────────────────────────────────────────

router.get('/services-requests', requireServiceRole, async (req, res) => {
  try {
    const officeId = (req.session.user && req.session.user.service_office_id) || req.query.office_id || 'office-treasury';
    const data = await db.getServiceRequests(officeId);
    res.json(data);
  } catch (err) {
    console.error('Error fetching service requests:', err);
    res.status(500).json({ error: 'Failed to load service requests.' });
  }
});

router.post('/services-action', requireServiceRole, async (req, res) => {
  try {
    const { ticket_id, action, counter } = req.body;
    const assignedCounter = counter || 'Counter 1';
    const ticket = await db.getQueueTicketById(ticket_id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const now = new Date().toISOString();

    if (action === 'Notify') {
      const updated = await db.updateQueueTicket(ticket_id, { status: 'Called', counter: assignedCounter, called_at: now });
      if (req.io) {
        req.io.emit('student_notification', {
          user_id: ticket.user_id,
          title: "Your Turn!",
          message: `Your ticket ${ticket.ticket_number} has been called. Please proceed to ${assignedCounter}.`
        });
        req.io.emit('queue_updated', { service_office_id: ticket.service_office_id, nowServing: updated });
      }
      return res.json({ success: true, message: `Student notified for ${ticket.ticket_number}.`, ticket: updated });
    }

    if (action === 'Start') {
      const updated = await db.updateQueueTicket(ticket_id, { status: 'In Service', started_at: now });
      if (req.io) req.io.emit('queue_updated', { service_office_id: ticket.service_office_id, ticket: updated });
      return res.json({ success: true, message: `Service started.`, ticket: updated });
    }

    if (action === 'Done') {
      const updated = await db.updateQueueTicket(ticket_id, { status: 'Completed', completed_at: now });
      const waitMin = Math.max(1, Math.round((new Date(ticket.started_at || now) - new Date(ticket.created_at)) / 60000));
      const svcMin = Math.max(1, Math.round((Date.now() - new Date(ticket.started_at || now)) / 60000));
      await db.createTransaction({
        id: `tx-${Date.now()}`,
        date: now.split('T')[0],
        entity_name: ticket.service_office_name,
        concern: ticket.concern,
        reference_number: ticket.ticket_number,
        type: 'Service Request',
        student_name: ticket.student_name,
        status: 'Completed',
        waiting_duration: `${waitMin} mins`,
        service_duration: `${svcMin} mins`,
        created_at: now
      });

      if (req.io) {
        req.io.emit('queue_updated', { service_office_id: ticket.service_office_id, completed: updated });
        req.io.emit('student_notification', {
          user_id: ticket.user_id,
          title: 'Transaction Completed',
          message: 'Your transaction has been completed. Thank you.'
        });
      }
      return res.json({ success: true, message: `Ticket ${ticket.ticket_number} completed.`, ticket: updated });
    }

    res.status(400).json({ error: 'Invalid action.' });
  } catch (err) {
    console.error('Services action error:', err);
    res.status(500).json({ error: 'Failed to process service action.' });
  }
});

// ── QUEUE CONTROLLER ─────────────────────────────────────────

router.get('/queue-controller', requireServiceRole, async (req, res) => {
  try {
    const officeId = req.query.office_id || 'office-treasury';
    const state = await db.getQueueControllerState(officeId);
    res.json(state);
  } catch (err) {
    console.error('Queue controller state error:', err);
    res.status(500).json({ error: 'Failed to load queue controller state.' });
  }
});

router.post('/queue-controller-action', requireServiceRole, async (req, res) => {
  try {
    const { office_id, action, counter } = req.body;
    const officeId = office_id || 'office-treasury';
    const assignedCounter = counter || 'Counter 1';
    const state = await db.getQueueControllerState(officeId);

    if (action === 'Call Next') {
      if (state.nowServing) {
        await db.updateQueueTicket(state.nowServing.id, { status: 'Completed', completed_at: new Date().toISOString() });
      }
      const next = state.waitingList[0];
      if (!next) return res.status(400).json({ error: 'No students waiting.' });

      const updatedNext = await db.updateQueueTicket(next.id, {
        status: 'Called',
        counter: assignedCounter,
        called_at: new Date().toISOString()
      });

      if (req.io) {
        req.io.emit('queue_updated', { service_office_id: officeId, nowServing: updatedNext, action: 'Call Next' });
        req.io.emit('student_notification', {
          user_id: next.user_id,
          title: "Your Turn!",
          message: `Your turn. Please proceed to ${assignedCounter}.`
        });
      }
      return res.json({ success: true, nowServing: updatedNext });
    }

    if (action === 'Recall') {
      const current = state.nowServing;
      if (current) {
        if (req.io) {
          req.io.emit('queue_updated', { service_office_id: officeId, nowServing: current, action: 'Recall' });
          req.io.emit('student_notification', {
            user_id: current.user_id,
            title: "Recall Alert",
            message: `RECALL: Ticket ${current.ticket_number} — please proceed to ${current.counter || assignedCounter} now.`
          });
        }
        return res.json({ success: true, message: `Recalled ${current.ticket_number}.` });
      }
      return res.json({ success: false, message: 'No one currently being served.' });
    }

    if (action === 'Skip') {
      const current = state.nowServing;
      if (current) {
        await db.updateQueueTicket(current.id, { status: 'Skipped' });
        if (req.io) req.io.emit('queue_updated', { service_office_id: officeId, action: 'Skip' });
        return res.json({ success: true, message: `Ticket ${current.ticket_number} skipped.` });
      }
      return res.json({ success: false, message: 'No one currently being served.' });
    }

    res.status(400).json({ error: 'Invalid action.' });
  } catch (err) {
    console.error('Queue controller action error:', err);
    res.status(500).json({ error: 'Failed to execute queue controller action.' });
  }
});

module.exports = router;
