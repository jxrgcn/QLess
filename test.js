// test.js — Comprehensive Automated Test Suite for Q-Less
const assert = require('assert');
const http = require('http');
const ioClient = require('socket.io-client');
const db = require('./database');

// Import server setup
const express = require('express');
const path = require('path');
const socketIo = require('socket.io');
const session = require('express-session');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const staffRoutes = require('./routes/staff');
const adminRoutes = require('./routes/admin');

async function runTests() {
  console.log('====================================================');
  console.log(' 🚀 RUNNING Q-LESS FULL SYSTEM & REALTIME DATABASE TESTS');
  console.log('====================================================\n');

  // Step 1: Test Database Initialization & Dialect Translation
  console.log('▶ [1/4] Testing Database Schema, SQL Translator & Queries...');
  await db.ready;
  
  // Test PostgreSQL SQL parameter translator
  const mockPgDb = Object.create(db);
  mockPgDb.isPg = true;
  const convertedSql = mockPgDb.translateSql('INSERT INTO dept_concerns (id, concern) VALUES (?, ?);');
  assert.strictEqual(convertedSql, 'INSERT INTO dept_concerns (id, concern) VALUES ($1, $2);', 'SQL translator should convert ? to $1, $2');
  const convertedAutoInc = mockPgDb.translateSql('CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT);');
  assert.strictEqual(convertedAutoInc, 'CREATE TABLE test (id SERIAL PRIMARY KEY);', 'SQL translator should convert AUTOINCREMENT to SERIAL');
  console.log('  ✔ SQL Translator (? -> $1, $2, AUTOINCREMENT -> SERIAL) verified.');

  const user = await db.findUserByEmail('student@mapua.edu.ph');
  assert.ok(user, 'Default student should exist in database.');
  assert.strictEqual(user.student_number, '2023104592', 'Student number should match default.');
  console.log('  ✔ Database connection & user query verified.');

  const depts = await db.getDepartments();
  assert.ok(Array.isArray(depts) && depts.length >= 6, 'Departments should be populated.');
  console.log(`  ✔ Departments loaded (${depts.length} departments found).`);

  const apptSlotTaken = await db.checkAppointmentSlot('dept-soit', '2026-09-08', '10:30 AM');
  assert.strictEqual(apptSlotTaken, true, 'Default 10:30 AM slot on 2026-09-08 should be marked taken.');
  console.log('  ✔ Slot check query verified.');

  // Step 2: Spin up Express + Socket.IO Server on ephemeral port
  console.log('\n▶ [2/4] Starting Server & Socket.IO Listener...');
  const app = express();
  const server = http.createServer(app);
  const io = socketIo(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));

  app.use((req, res, next) => {
    req.io = io;
    next();
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/admin', adminRoutes);

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`  ✔ Test server running on ${baseUrl}`);

  // Helper HTTP fetcher
  async function api(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await res.json();
    return { status: res.status, data };
  }

  // Step 3: Test API Endpoints
  console.log('\n▶ [3/4] Testing API Endpoints with SQLite DB integration...');

  // Auth: Register new user
  const newEmail = `test_${Date.now()}@mapua.edu.ph`;
  const regRes = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      full_name: 'Test Student',
      student_number: '2026999999',
      email: newEmail,
      password: 'password123',
      confirm_password: 'password123'
    })
  });
  assert.strictEqual(regRes.status, 200, 'Registration should return HTTP 200.');
  assert.ok(regRes.data.success, 'Registration response should be success.');
  console.log('  ✔ API POST /api/auth/register -> User created in SQLite.');

  // Auth: Login student
  const loginRes = await api('/api/auth/login-student', {
    method: 'POST',
    body: JSON.stringify({ email: newEmail, password: 'password123' })
  });
  assert.strictEqual(loginRes.status, 200, 'Login should return HTTP 200.');
  assert.ok(loginRes.data.user, 'Login should return user object.');
  console.log('  ✔ API POST /api/auth/login-student -> Authenticated successfully.');

  // Student: Book Appointment
  const bookRes = await api('/api/student/book-appointment', {
    method: 'POST',
    body: JSON.stringify({
      department_id: 'dept-soit',
      concern: 'Academic Advising',
      date: '2026-12-31',
      time: `0${Math.floor(Math.random() * 8 + 1)}:30 PM`
    })
  });
  if (bookRes.status !== 200) console.error('Book appointment response error:', bookRes.data);
  assert.strictEqual(bookRes.status, 200, 'Book appointment should succeed.');
  const bookedApptId = bookRes.data.appointment.id;
  assert.ok(bookedApptId, 'Booked appointment ID should exist.');
  console.log(`  ✔ API POST /api/student/book-appointment -> Appointment ${bookRes.data.appointment.appointment_number} inserted in SQLite.`);

  // Student: Join Queue
  const queueRes = await api('/api/student/join-queue', {
    method: 'POST',
    body: JSON.stringify({
      service_office_id: 'office-treasury',
      concern: 'Assessment Concern'
    })
  });
  assert.strictEqual(queueRes.status, 200, 'Join queue should succeed.');
  const joinedTicketId = queueRes.data.ticket.id;
  assert.ok(joinedTicketId, 'Queue ticket ID should exist.');
  console.log(`  ✔ API POST /api/student/join-queue -> Ticket ${queueRes.data.ticket.ticket_number} created in SQLite.`);

  // Staff: Dept Action (Notify & Done)
  const notifyRes = await api('/api/staff/dept-action', {
    method: 'POST',
    body: JSON.stringify({ appointment_id: bookedApptId, action: 'Notify' })
  });
  assert.strictEqual(notifyRes.status, 200, 'Dept notify action should succeed.');
  assert.strictEqual(notifyRes.data.appointment.status, 'Called', 'Status should update to Called.');
  console.log('  ✔ API POST /api/staff/dept-action (Notify) -> SQLite status updated to Called.');

  // Staff: Services Action (Done)
  const svcDoneRes = await api('/api/staff/services-action', {
    method: 'POST',
    body: JSON.stringify({ ticket_id: joinedTicketId, action: 'Done', counter: 'Counter 2' })
  });
  assert.strictEqual(svcDoneRes.status, 200, 'Services done action should succeed.');
  assert.strictEqual(svcDoneRes.data.ticket.status, 'Completed', 'Ticket status should update to Completed.');
  console.log('  ✔ API POST /api/staff/services-action (Done) -> SQLite ticket completed & transaction recorded.');

  // Admin: Analytics
  const adminRes = await api('/api/admin/analytics');
  assert.strictEqual(adminRes.status, 200, 'Admin analytics should succeed.');
  assert.ok(adminRes.data.analytics.totalAppointments >= 3, 'Analytics count should reflect SQLite data.');
  console.log('  ✔ API GET /api/admin/analytics -> Analytics computed from SQLite.');

  // Step 4: Real-time Socket.IO Broadcast Verification
  console.log('\n▶ [4/4] Testing Real-Time Socket.IO Broadcasts...');

  const clientSocket = ioClient(baseUrl);
  await new Promise(resolve => clientSocket.on('connect', resolve));
  console.log('  ✔ Socket.IO client connected to test server.');

  const socketPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket event timeout')), 4000);
    clientSocket.on('queue_updated', data => {
      clearTimeout(timeout);
      resolve(data);
    });
  });

  // Trigger action that emits queue_updated
  await api('/api/student/join-queue', {
    method: 'POST',
    body: JSON.stringify({
      service_office_id: 'office-treasury',
      concern: 'Refund Concern'
    })
  });

  const eventData = await socketPromise;
  assert.strictEqual(eventData.service_office_id, 'office-treasury', 'Socket broadcast should include service office ID.');
  console.log('  ✔ Real-time Socket.IO event [queue_updated] received instantly by client!');

  clientSocket.close();
  server.close();

  console.log('\n====================================================');
  console.log(' 🎉 ALL TESTS PASSED SUCCESSFULLY! (100% SUCCESS)');
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
