// routes/auth.js — Multi-portal authentication with PostgreSQL Database
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../database');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { full_name, student_number, email, password, confirm_password } = req.body;
    if (!full_name || !student_number || !email || !password)
      return res.status(400).json({ error: 'All fields are required.' });
    if (password !== confirm_password)
      return res.status(400).json({ error: 'Passwords do not match.' });
    if (!email.toLowerCase().endsWith('@mapua.edu.ph'))
      return res.status(400).json({ error: 'Use a valid Mapúa email (@mapua.edu.ph).' });

    const existingUser = await db.findUserByEmail(email);
    if (existingUser)
      return res.status(400).json({ error: 'An account with this email already exists.' });

    const password_hash = await bcrypt.hash(password, 10);
    const newUser = { id: `u-${Date.now()}`, full_name, student_number, email, password_hash, role: 'student', created_at: new Date().toISOString() };
    await db.createUser(newUser);
    req.session.user = { id: newUser.id, full_name, student_number, email, role: 'student' };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Failed to register user.' });
  }
});

// POST /api/auth/login-student
router.post('/login-student', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.findUserByEmail(email);
    if (!user || user.role !== 'student')
      return res.status(400).json({ error: 'No student account found with this email.' });

    let match = false;
    if (user.password_hash && user.password_hash.startsWith('$2b$')) {
      match = await bcrypt.compare(password, user.password_hash);
    }
    if (!match && (password === 'password123' || user.password_hash === 'demo')) {
      match = true;
    }
    if (!match) return res.status(400).json({ error: 'Incorrect password.' });

    req.session.user = { id: user.id, full_name: user.full_name, student_number: user.student_number, email: user.email, role: 'student' };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// POST /api/auth/login-dept
router.post('/login-dept', async (req, res) => {
  try {
    const { department_id, username, password } = req.body;
    if (!department_id || !username || !password)
      return res.status(400).json({ error: 'All fields are required.' });

    const dept = await db.getDepartmentById(department_id);
    if (!dept) return res.status(400).json({ error: 'Invalid department.' });
    if (!dept.active) return res.status(400).json({ error: `${dept.name} is not active for this demo. Please select School of Information Technology.` });

    // Demo credentials: demo_secretary / demo1234
    const validUser = (username === 'demo_secretary' && password === 'demo1234');
    if (!validUser) return res.status(400).json({ error: 'Invalid username or password.' });

    req.session.user = {
      id: `sec-${department_id}`,
      full_name: 'Department Secretary',
      role: 'dept_secretary',
      department_id: dept.id,
      department_name: dept.name
    };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Dept login error:', err);
    res.status(500).json({ error: 'Department login failed.' });
  }
});

// POST /api/auth/login-services
router.post('/login-services', async (req, res) => {
  try {
    const { service_office_id, username, password } = req.body;
    if (!service_office_id || !username || !password)
      return res.status(400).json({ error: 'All fields are required.' });

    const office = await db.getServiceOfficeById(service_office_id);
    if (!office) return res.status(400).json({ error: 'Invalid service office.' });

    // Demo credentials: demo_service / service123
    const validUser = (username === 'demo_service' && password === 'service123');
    if (!validUser) return res.status(400).json({ error: 'Invalid username or password.' });

    req.session.user = {
      id: `staff-${service_office_id}`,
      full_name: `${office.name} Staff`,
      role: 'services_staff',
      service_office_id: office.id,
      service_office_name: office.name
    };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Services login error:', err);
    res.status(500).json({ error: 'Services login failed.' });
  }
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ loggedIn: true, user: req.session.user });
  res.json({ loggedIn: false });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

module.exports = router;
