// routes/auth.js — Multi-portal authentication with PostgreSQL Database
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../database');

// Helper: Email format validator
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// POST /api/auth/login — Unified multi-portal login
router.post('/login', async (req, res) => {
  try {
    const { portal_type, email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const trimmedEmail = email.trim().toLowerCase();
    if (!isValidEmail(trimmedEmail))
      return res.status(400).json({ error: 'Invalid email format.' });

    const targetPortal = portal_type || 'student';

    // Check email domain requirement according to portal type
    if (targetPortal === 'student' && !trimmedEmail.endsWith('@mymail.mapua.edu.ph')) {
      return res.status(400).json({ error: 'Student login requires a @mymail.mapua.edu.ph email address.' });
    }
    if ((targetPortal === 'department' || targetPortal === 'service') && (!trimmedEmail.endsWith('@mapua.edu.ph') || trimmedEmail.endsWith('@mymail.mapua.edu.ph'))) {
      return res.status(400).json({ error: 'Staff login requires an official @mapua.edu.ph email address.' });
    }

    const user = await db.findUserByEmail(trimmedEmail);
    if (!user)
      return res.status(400).json({ error: 'Account does not exist.' });

    if (user.role !== targetPortal)
      return res.status(400).json({ error: `Account does not exist for the ${targetPortal} portal.` });

    let match = false;
    if (user.password_hash) {
      if (user.password_hash.startsWith('$2b$') || user.password_hash.startsWith('$2a$')) {
        try {
          match = await bcrypt.compare(password, user.password_hash);
        } catch (e) {
          match = false;
        }
      }
      if (!match) {
        match = (user.password_hash === password) ||
                (password === 'student123' && user.email === 'studentdemo@mymail.mapua.edu.ph') ||
                (password === 'department123' && user.email === 'departmental@mapua.edu.ph') ||
                (password === 'service123' && user.email === 'service@mapua.edu.ph');
        if (match) {
          const newHash = await bcrypt.hash(password, 10);
          db.run(`UPDATE users SET password_hash = $1 WHERE id = $2;`, [newHash, user.id]).catch(() => {});
        }
      }
    }

    if (!match)
      return res.status(400).json({ error: 'Incorrect password.' });

    // Map department & service office IDs if needed
    let deptId = user.role === 'department' ? 'dept-soit' : null;
    let serviceOfficeId = user.role === 'service' ? 'office-treasury' : null;

    if (user.role === 'service' && user.service_office) {
      const off = await db.get(`SELECT id FROM service_offices WHERE LOWER(name) = LOWER($1);`, [user.service_office]);
      if (off) serviceOfficeId = off.id;
    }

    req.session.user = {
      id: user.id,
      full_name: user.full_name,
      student_number: user.student_number || '2023100001',
      email: user.email,
      role: user.role,
      school: user.school || null,
      department: user.department || null,
      department_id: deptId,
      department_name: user.department || 'School of Information Technology',
      service_office: user.service_office || null,
      service_office_id: serviceOfficeId,
      service_office_name: user.service_office || 'Treasury'
    };

    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

// POST /api/auth/register-student
router.post('/register-student', async (req, res) => {
  try {
    const { full_name, email, password, confirm_password, school } = req.body;

    if (!full_name || !email || !password || !confirm_password || !school)
      return res.status(400).json({ error: 'All fields are required.' });

    const trimmedEmail = email.trim().toLowerCase();
    if (!isValidEmail(trimmedEmail))
      return res.status(400).json({ error: 'Invalid email format.' });

    if (!trimmedEmail.endsWith('@mymail.mapua.edu.ph'))
      return res.status(400).json({ error: 'Student email must end with @mymail.mapua.edu.ph.' });

    if (password !== confirm_password)
      return res.status(400).json({ error: 'Passwords do not match.' });

    if (school !== 'School of Information Technology')
      return res.status(400).json({ error: 'Only School of Information Technology is available for student registration at this time.' });

    const existingUser = await db.findUserByEmail(trimmedEmail);
    if (existingUser)
      return res.status(400).json({ error: 'An account with this email already exists.' });

    const password_hash = await bcrypt.hash(password, 10);
    const userId = `u-${Date.now()}`;
    const studentNumber = `2026${Math.floor(100000 + Math.random() * 900000)}`;

    const newUser = {
      id: userId,
      full_name,
      student_number: studentNumber,
      email: trimmedEmail,
      password_hash,
      role: 'student',
      school,
      created_at: new Date().toISOString()
    };

    await db.createUser(newUser);

    req.session.user = {
      id: userId,
      full_name,
      student_number: studentNumber,
      email: trimmedEmail,
      role: 'student',
      school
    };

    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Student register error:', err);
    res.status(500).json({ error: 'Failed to register student.' });
  }
});

// POST /api/auth/register-department
router.post('/register-department', async (req, res) => {
  try {
    const { full_name, email, password, confirm_password, department } = req.body;

    if (!full_name || !email || !password || !confirm_password || !department)
      return res.status(400).json({ error: 'All fields are required.' });

    const trimmedEmail = email.trim().toLowerCase();
    if (!isValidEmail(trimmedEmail))
      return res.status(400).json({ error: 'Invalid email format.' });

    if (!trimmedEmail.endsWith('@mapua.edu.ph') || trimmedEmail.endsWith('@mymail.mapua.edu.ph'))
      return res.status(400).json({ error: 'Departmental staff email must end with @mapua.edu.ph.' });

    if (password !== confirm_password)
      return res.status(400).json({ error: 'Passwords do not match.' });

    const existingUser = await db.findUserByEmail(trimmedEmail);
    if (existingUser)
      return res.status(400).json({ error: 'An account with this email already exists.' });

    const password_hash = await bcrypt.hash(password, 10);
    const userId = `u-dept-${Date.now()}`;

    const newUser = {
      id: userId,
      full_name,
      email: trimmedEmail,
      password_hash,
      role: 'department',
      department,
      created_at: new Date().toISOString()
    };

    await db.createUser(newUser);

    req.session.user = {
      id: userId,
      full_name,
      email: trimmedEmail,
      role: 'department',
      department,
      department_id: 'dept-soit',
      department_name: department
    };

    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Department register error:', err);
    res.status(500).json({ error: 'Failed to register departmental staff.' });
  }
});

// POST /api/auth/register-service
router.post('/register-service', async (req, res) => {
  try {
    const { full_name, email, password, confirm_password, service_office } = req.body;

    if (!full_name || !email || !password || !confirm_password || !service_office)
      return res.status(400).json({ error: 'All fields are required.' });

    const trimmedEmail = email.trim().toLowerCase();
    if (!isValidEmail(trimmedEmail))
      return res.status(400).json({ error: 'Invalid email format.' });

    if (!trimmedEmail.endsWith('@mapua.edu.ph') || trimmedEmail.endsWith('@mymail.mapua.edu.ph'))
      return res.status(400).json({ error: 'Service office email must end with @mapua.edu.ph.' });

    if (password !== confirm_password)
      return res.status(400).json({ error: 'Passwords do not match.' });

    const validOffices = [
      'Admissions', 'Treasury', 'Registrar', 'Accounting',
      'Cashier', 'Student Affairs', 'DO-IT / IT Helpdesk', 'Other Services'
    ];
    if (!validOffices.includes(service_office))
      return res.status(400).json({ error: 'Please select a valid service office from the list.' });

    const existingUser = await db.findUserByEmail(trimmedEmail);
    if (existingUser)
      return res.status(400).json({ error: 'An account with this email already exists.' });

    const off = await db.get(`SELECT id, name FROM service_offices WHERE LOWER(name) = LOWER($1) OR id = $1;`, [service_office]);
    const serviceOfficeName = off ? off.name : service_office;
    const serviceOfficeId = off ? off.id : 'office-treasury';

    const password_hash = await bcrypt.hash(password, 10);
    const userId = `u-svc-${Date.now()}`;

    const newUser = {
      id: userId,
      full_name,
      email: trimmedEmail,
      password_hash,
      role: 'service',
      service_office: serviceOfficeName,
      created_at: new Date().toISOString()
    };

    await db.createUser(newUser);

    req.session.user = {
      id: userId,
      full_name,
      email: trimmedEmail,
      role: 'service',
      service_office: serviceOfficeName,
      service_office_id: serviceOfficeId,
      service_office_name: serviceOfficeName
    };

    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Service register error:', err);
    res.status(500).json({ error: 'Failed to register service staff.' });
  }
});

// Legacy Endpoint Wrappers for Backward Compatibility
router.post('/register', async (req, res) => {
  req.body.school = req.body.school || 'School of Information Technology';
  return router.handle(Object.assign(req, { url: '/register-student' }), res);
});

router.post('/login-student', async (req, res) => {
  req.body.portal_type = 'student';
  return router.handle(Object.assign(req, { url: '/login' }), res);
});

router.post('/login-dept', async (req, res) => {
  if (req.body.username && !req.body.email) {
    if (req.body.username === 'departmental@mapua.edu.ph' || req.body.username === 'demo_secretary') {
      req.body.email = 'departmental@mapua.edu.ph';
    } else {
      req.body.email = req.body.username;
    }
  }
  req.body.portal_type = 'department';
  return router.handle(Object.assign(req, { url: '/login' }), res);
});

router.post('/login-services', async (req, res) => {
  if (req.body.username && !req.body.email) {
    if (req.body.username === 'service@mapua.edu.ph' || req.body.username === 'demo_service') {
      req.body.email = 'service@mapua.edu.ph';
    } else {
      req.body.email = req.body.username;
    }
  }
  req.body.portal_type = 'service';
  return router.handle(Object.assign(req, { url: '/login' }), res);
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
