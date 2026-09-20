// routes/student.js — Student Portal API with PostgreSQL Database & Real-Time Socket
const express = require('express');
const router = express.Router();
const db = require('../database');

router.get('/departments', async (req, res) => {
  try {
    const departments = await db.getDepartments();
    const professors = await db.getProfessors();
    const concerns = await db.getDeptConcerns();
    res.json({ departments, professors, concerns });
  } catch (err) {
    console.error('Error fetching departments:', err);
    res.status(500).json({ error: 'Failed to load departments.' });
  }
});

router.get('/services', async (req, res) => {
  try {
    const offices = await db.getServiceOffices();
    const concerns = await db.getServiceConcernsMap();
    res.json({ offices, concerns });
  } catch (err) {
    console.error('Error fetching services:', err);
    res.status(500).json({ error: 'Failed to load services.' });
  }
});

router.get('/active-requests', async (req, res) => {
  try {
    const userId = req.session.user ? req.session.user.id : 'u-student-1';
    const active = await db.getActiveRequests(userId);
    res.json(active);
  } catch (err) {
    console.error('Error fetching active requests:', err);
    res.status(500).json({ error: 'Failed to load active requests.' });
  }
});

router.post('/book-appointment', async (req, res) => {
  try {
    const { department_id, concern, professor, date, time } = req.body;
    const user = req.session.user || { id: 'u-student-1', full_name: 'Juan Dela Cruz', student_number: '2023104592' };

    if (!department_id || !concern || !date || !time)
      return res.status(400).json({ error: 'Department, concern, date, and time are required.' });
    if (department_id !== 'dept-soit')
      return res.status(400).json({ error: 'Selected department is not active for this demo.' });

    const isBooked = await db.checkAppointmentSlot(department_id, date, time);
    if (isBooked) return res.status(400).json({ error: 'This time slot is already taken. Please choose another.' });

    const num = `A-${Math.floor(100 + Math.random() * 900)}`;
    const qr = `QL-APP-${num.replace('-','')}-${user.student_number}`;

    const appt = {
      id: `app-${Date.now()}`,
      appointment_number: num,
      user_id: user.id,
      student_name: user.full_name,
      student_number: user.student_number,
      department_id,
      department_name: 'School of Information Technology',
      concern,
      professor: professor || 'None (No specific professor)',
      date, time,
      status: 'Scheduled',
      qr_token: qr,
      created_at: new Date().toISOString(),
      checked_in_at: null, called_at: null, started_at: null, completed_at: null
    };

    await db.createAppointment(appt);

    if (req.io) {
      req.io.emit('appointment_created', appt);
      req.io.emit('dept_appointment_updated', appt);
    }

    res.json({ success: true, appointment: appt });
  } catch (err) {
    console.error('Book appointment error:', err);
    res.status(500).json({ error: 'Failed to book appointment.' });
  }
});

router.post('/join-queue', async (req, res) => {
  try {
    const { service_office_id, concern } = req.body;
    const user = req.session.user || { id: 'u-student-1', full_name: 'Juan Dela Cruz', student_number: '2023104592' };

    if (!service_office_id || !concern) return res.status(400).json({ error: 'Service office and concern are required.' });
    const office = await db.getServiceOfficeById(service_office_id);
    if (!office) return res.status(404).json({ error: 'Office not found.' });

    const prefix = office.name.charAt(0).toUpperCase();
    const count = await db.countQueueTicketsByOffice(service_office_id);
    const ticketNum = `${prefix}-${String(30 + count + 1).padStart(3,'0')}`;
    const qr = `QL-QUE-${ticketNum.replace('-','')}-${user.student_number}`;
    const waitingAhead = await db.countWaitingQueueTickets(service_office_id);
    const nowServing = await db.getNowServingQueueTicket(service_office_id);

    const ticket = {
      id: `q-${Date.now()}`,
      ticket_number: ticketNum,
      user_id: user.id,
      student_name: user.full_name,
      student_number: user.student_number,
      service_office_id: office.id,
      service_office_name: office.name,
      concern,
      counter: null,
      status: 'Waiting',
      position: waitingAhead + 1,
      estimated_wait_min: Math.max(5, (waitingAhead + 1) * 5),
      now_serving: nowServing ? nowServing.ticket_number : null,
      qr_token: qr,
      created_at: new Date().toISOString(),
      called_at: null, started_at: null, completed_at: null
    };

    await db.createQueueTicket(ticket);

    if (req.io) {
      req.io.emit('queue_updated', { service_office_id: office.id, ticket });
    }

    res.json({ success: true, ticket });
  } catch (err) {
    console.error('Join queue error:', err);
    res.status(500).json({ error: 'Failed to join queue.' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const transactions = await db.getTransactions();
    res.json({ transactions });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Failed to fetch history.' });
  }
});

module.exports = router;
