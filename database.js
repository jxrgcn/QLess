// database.js — Supabase PostgreSQL Database Store for Q-Less using pg
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;

class Database {
  constructor() {
    if (connectionString) {
      console.log('Connecting to PostgreSQL database via connection string...');
      this.pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
      });
      this.ready = this.initSchema();
    } else {
      console.log('No DATABASE_URL supplied; pg.Pool will use connection string when environment variable is set.');
      this.ready = Promise.resolve();
    }
  }

  translateSql(sql) {
    let paramIndex = 1;
    let translated = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    translated = translated.replace(/\?/g, () => `$${paramIndex++}`);
    return translated;
  }

  async query(sql, params = []) {
    const pgSql = this.translateSql(sql);
    return await this.pool.query(pgSql, params);
  }

  async run(sql, params = []) {
    return await this.query(sql, params);
  }

  async get(sql, params = []) {
    const res = await this.query(sql, params);
    return (res && res.rows && res.rows.length > 0) ? res.rows[0] : null;
  }

  async all(sql, params = []) {
    const res = await this.query(sql, params);
    return (res && res.rows) ? res.rows : [];
  }

  async initSchema() {
    await this.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      student_number TEXT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at TEXT NOT NULL
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS students (
      user_id TEXT PRIMARY KEY,
      school TEXT NOT NULL
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS departmental_staff (
      user_id TEXT PRIMARY KEY,
      department TEXT NOT NULL
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS service_staff (
      user_id TEXT PRIMARY KEY,
      service_office TEXT NOT NULL
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS professors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department_id TEXT
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS dept_concerns (
      id SERIAL PRIMARY KEY,
      concern TEXT NOT NULL
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS service_offices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS service_concerns (
      id SERIAL PRIMARY KEY,
      office_id TEXT NOT NULL,
      concern TEXT NOT NULL
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      appointment_number TEXT NOT NULL,
      user_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      student_number TEXT NOT NULL,
      department_id TEXT NOT NULL,
      department_name TEXT NOT NULL,
      concern TEXT NOT NULL,
      professor TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Scheduled',
      qr_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      checked_in_at TEXT,
      called_at TEXT,
      started_at TEXT,
      completed_at TEXT
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS queue_tickets (
      id TEXT PRIMARY KEY,
      ticket_number TEXT NOT NULL,
      user_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      student_number TEXT NOT NULL,
      service_office_id TEXT NOT NULL,
      service_office_name TEXT NOT NULL,
      concern TEXT NOT NULL,
      counter TEXT,
      status TEXT NOT NULL DEFAULT 'Waiting',
      position INTEGER NOT NULL DEFAULT 1,
      estimated_wait_min INTEGER NOT NULL DEFAULT 5,
      now_serving TEXT,
      qr_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      called_at TEXT,
      started_at TEXT,
      completed_at TEXT
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      concern TEXT NOT NULL,
      reference_number TEXT NOT NULL,
      type TEXT NOT NULL,
      student_name TEXT NOT NULL,
      status TEXT NOT NULL,
      waiting_duration TEXT NOT NULL,
      service_duration TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);

    await this.run(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );`);

    // Always ensure all required service offices exist
    const defaultServiceOffices = [
      { id: 'office-admissions', name: 'Admissions' },
      { id: 'office-treasury', name: 'Treasury' },
      { id: 'office-registrar', name: 'Registrar' },
      { id: 'office-accounting', name: 'Accounting' },
      { id: 'office-cashier', name: 'Cashier' },
      { id: 'office-sa', name: 'Student Affairs' },
      { id: 'office-doit', name: 'DO-IT / IT Helpdesk' },
      { id: 'office-other', name: 'Other Services' }
    ];

    for (const off of defaultServiceOffices) {
      const existing = await this.get(`SELECT id FROM service_offices WHERE id = $1 OR LOWER(name) = LOWER($2);`, [off.id, off.name]);
      if (!existing) {
        await this.run(`INSERT INTO service_offices (id, name, active) VALUES ($1, $2, 1);`, [off.id, off.name]);
      }
    }

    // Ensure default service concerns for all service offices
    const allOffices = await this.all(`SELECT id, name FROM service_offices;`);
    for (const off of allOffices) {
      const count = await this.get(`SELECT COUNT(*) as count FROM service_concerns WHERE office_id = $1;`, [off.id]);
      if (!count || Number(count.count) === 0) {
        const concerns = ['General Inquiry', 'Document Request', 'Payment / Assessment', 'Processing Concern', 'Other'];
        for (const c of concerns) {
          await this.run(`INSERT INTO service_concerns (office_id, concern) VALUES ($1, $2);`, [off.id, c]);
        }
      }
    }

    // Check if initial seeding is needed
    const userCount = await this.get(`SELECT COUNT(*) as count FROM users;`);
    if (userCount && Number(userCount.count) === 0) {
      console.log('Seeding initial Mapúa data into PostgreSQL database...');

      await this.run(`INSERT INTO users (id, full_name, student_number, email, password_hash, role, created_at) VALUES
        ('u-student-1', 'Juan Dela Cruz', '2023104592', 'student@mapua.edu.ph', 'demo', 'student', $1),
        ('u-student-2', 'Maria Santos', '2023100011', 'maria@mapua.edu.ph', 'demo', 'student', $2);`,
        [new Date().toISOString(), new Date().toISOString()]);

      await this.run(`INSERT INTO departments (id, name, code, active) VALUES
        ('dept-soit', 'School of Information Technology', 'SOIT', 1),
        ('dept-smda', 'School of Multimedia and Digital Arts', 'SMDA', 0),
        ('dept-etysb', 'E.T. Yuchengco School of Business', 'ETYSB', 0),
        ('dept-shs', 'School of Health Sciences', 'SHS', 0),
        ('dept-sn', 'School of Nursing', 'SN', 0),
        ('dept-som', 'School of Medicine', 'SOM', 0);`);

      await this.run(`INSERT INTO professors (id, name) VALUES
        ('none', 'None (No specific professor)'),
        ('p1', 'Anne Curtis'),
        ('p2', 'Kathryn Bernardo'),
        ('p3', 'Nadine Lustre'),
        ('p4', 'Bea Alonzo'),
        ('p5', 'Julia Barretto'),
        ('p6', 'Piolo Pascual'),
        ('p7', 'Dingdong Dantes'),
        ('p8', 'Daniel Padilla'),
        ('p9', 'Alden Richards'),
        ('p10', 'Joshua Garcia');`);

      const deptConcerns = [
        'Grade Consultation',
        'Lecture Consultation',
        'Academic Advising',
        'Enrollment / Academic Concern',
        'Meeting with a Professor'
      ];
      for (const c of deptConcerns) {
        await this.run(`INSERT INTO dept_concerns (concern) VALUES ($1);`, [c]);
      }

      await this.run(`INSERT INTO appointments (
        id, appointment_number, user_id, student_name, student_number, department_id, department_name, concern, professor, date, time, status, qr_token, created_at
      ) VALUES
        ('app-101', 'A-101', 'u-student-1', 'Juan Dela Cruz', '2023104592', 'dept-soit', 'School of Information Technology', 'Grade Consultation', 'Anne Curtis', '2026-09-08', '10:30 AM', 'Scheduled', 'QL-APP-A101-2023104592', $1),
        ('app-102', 'A-102', 'u-student-2', 'Maria Santos', '2023100011', 'dept-soit', 'School of Information Technology', 'Enrollment / Academic Concern', 'None (No specific professor)', '2026-09-08', '11:00 AM', 'Scheduled', 'QL-APP-A102-2023100011', $2);`,
        [new Date(Date.now() - 7200000).toISOString(), new Date(Date.now() - 3600000).toISOString()]);

      await this.run(`INSERT INTO queue_tickets (
        id, ticket_number, user_id, student_name, student_number, service_office_id, service_office_name, concern, counter, status, position, estimated_wait_min, qr_token, created_at, called_at
      ) VALUES
        ('q-001', 'T-029', 'u-student-2', 'Maria Santos', '2023100011', 'office-treasury', 'Treasury', 'Payment Inquiry', 'Counter 1', 'Called', 1, 0, 'QL-QUE-T029-2023100011', $1, $2),
        ('q-002', 'T-030', 'u-student-1', 'Juan Dela Cruz', '2023104592', 'office-treasury', 'Treasury', 'Tuition Payment', NULL, 'Waiting', 2, 10, 'QL-QUE-T030-2023104592', $3, NULL),
        ('q-003', 'R-001', 'u-student-1', 'Juan Dela Cruz', '2023104592', 'office-registry', 'Registrar', 'Transcript Request', NULL, 'Waiting', 1, 5, 'QL-QUE-R001-2023104592', $4, NULL);`,
        [
          new Date(Date.now() - 3600000).toISOString(), new Date(Date.now() - 300000).toISOString(),
          new Date(Date.now() - 2400000).toISOString(),
          new Date(Date.now() - 1200000).toISOString()
        ]);

      await this.run(`INSERT INTO transactions (
        id, date, entity_name, concern, reference_number, type, student_name, status, waiting_duration, service_duration, created_at
      ) VALUES
        ('tx-001', '2026-09-04', 'School of Information Technology', 'Grade Consultation', 'A-098', 'Department Consultation', 'Juan Dela Cruz', 'Completed', '12 mins', '10 mins', $1),
        ('tx-002', '2026-09-04', 'Treasury', 'Payment Inquiry', 'T-028', 'Service Request', 'Maria Santos', 'Completed', '18 mins', '6 mins', $2);`,
        [new Date(Date.now() - 86400000).toISOString(), new Date(Date.now() - 86400000).toISOString()]);

      console.log('PostgreSQL database seeding complete!');
    }

    await this.seedDemoAccounts();
  }

  async seedDemoAccounts() {
    const bcrypt = require('bcrypt');
    const now = new Date().toISOString();

    // 1. Student demo
    const studentEmail = 'studentdemo@mymail.mapua.edu.ph';
    const existingStudent = await this.get(`SELECT id FROM users WHERE LOWER(email) = LOWER($1);`, [studentEmail]);
    if (!existingStudent) {
      const hash = await bcrypt.hash('student123', 10);
      const userId = 'u-student-demo';
      await this.run(
        `INSERT INTO users (id, full_name, student_number, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
        [userId, 'Demo Student', '2023100001', studentEmail, hash, 'student', now]
      );
      await this.run(
        `INSERT INTO students (user_id, school) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET school = EXCLUDED.school;`,
        [userId, 'School of Information Technology']
      );
    }

    // 2. Department demo
    const deptEmail = 'departmental@mapua.edu.ph';
    const existingDept = await this.get(`SELECT id FROM users WHERE LOWER(email) = LOWER($1);`, [deptEmail]);
    if (!existingDept) {
      const hash = await bcrypt.hash('department123', 10);
      const userId = 'u-dept-demo';
      await this.run(
        `INSERT INTO users (id, full_name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6);`,
        [userId, 'Department Staff', deptEmail, hash, 'department', now]
      );
      await this.run(
        `INSERT INTO departmental_staff (user_id, department) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET department = EXCLUDED.department;`,
        [userId, 'School of Information Technology']
      );
    }

    // 3. Service demo
    const serviceEmail = 'service@mapua.edu.ph';
    const existingService = await this.get(`SELECT id FROM users WHERE LOWER(email) = LOWER($1);`, [serviceEmail]);
    if (!existingService) {
      const hash = await bcrypt.hash('service123', 10);
      const userId = 'u-service-demo';
      await this.run(
        `INSERT INTO users (id, full_name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6);`,
        [userId, 'Service Staff', serviceEmail, hash, 'service', now]
      );
      await this.run(
        `INSERT INTO service_staff (user_id, service_office) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET service_office = EXCLUDED.service_office;`,
        [userId, 'Treasury']
      );
    }
  }

  // ── Database Methods ──────────────────────────────────────────────────

  async findUserByEmail(email) {
    await this.ready;
    if (!email) return null;
    const user = await this.get(`SELECT * FROM users WHERE LOWER(email) = LOWER($1);`, [email.trim()]);
    if (!user) return null;

    if (user.role === 'student') {
      const st = await this.get(`SELECT school FROM students WHERE user_id = $1;`, [user.id]);
      if (st) user.school = st.school;
    } else if (user.role === 'department') {
      const ds = await this.get(`SELECT department FROM departmental_staff WHERE user_id = $1;`, [user.id]);
      if (ds) user.department = ds.department;
    } else if (user.role === 'service') {
      const ss = await this.get(`SELECT service_office FROM service_staff WHERE user_id = $1;`, [user.id]);
      if (ss) user.service_office = ss.service_office;
    }
    return user;
  }

  async createUser(user) {
    await this.ready;
    await this.run(
      `INSERT INTO users (id, full_name, student_number, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
      [user.id, user.full_name, user.student_number || null, user.email, user.password_hash, user.role || 'student', user.created_at || new Date().toISOString()]
    );
    if (user.role === 'student' && user.school) {
      await this.run(`INSERT INTO students (user_id, school) VALUES ($1, $2);`, [user.id, user.school]);
    } else if (user.role === 'department' && user.department) {
      await this.run(`INSERT INTO departmental_staff (user_id, department) VALUES ($1, $2);`, [user.id, user.department]);
    } else if (user.role === 'service' && user.service_office) {
      await this.run(`INSERT INTO service_staff (user_id, service_office) VALUES ($1, $2);`, [user.id, user.service_office]);
    }
    return user;
  }

  async getDepartments() {
    await this.ready;
    const rows = await this.all(`SELECT id, name, code, active FROM departments ORDER BY name ASC;`);
    return rows.map(r => ({ ...r, active: Boolean(r.active) }));
  }

  async getDepartmentById(id) {
    await this.ready;
    const row = await this.get(`SELECT id, name, code, active FROM departments WHERE id = $1;`, [id]);
    if (!row) return null;
    return { ...row, active: Boolean(row.active) };
  }

  async getProfessors() {
    await this.ready;
    return await this.all(`SELECT id, name FROM professors;`);
  }

  async getDeptConcerns() {
    await this.ready;
    const rows = await this.all(`SELECT concern FROM dept_concerns;`);
    return rows.map(r => r.concern);
  }

  async getServiceOffices() {
    await this.ready;
    const rows = await this.all(`SELECT id, name, active FROM service_offices;`);
    return rows.map(r => ({ ...r, active: Boolean(r.active) }));
  }

  async getServiceOfficeById(id) {
    await this.ready;
    const row = await this.get(`SELECT id, name, active FROM service_offices WHERE id = $1;`, [id]);
    if (!row) return null;
    return { ...row, active: Boolean(row.active) };
  }

  async getServiceConcernsMap() {
    await this.ready;
    const rows = await this.all(`SELECT office_id, concern FROM service_concerns;`);
    const map = {};
    rows.forEach(r => {
      if (!map[r.office_id]) map[r.office_id] = [];
      map[r.office_id].push(r.concern);
    });
    return map;
  }

  async getActiveRequests(userId) {
    await this.ready;
    const appt = await this.get(
      `SELECT * FROM appointments WHERE user_id = $1 AND status IN ('Scheduled','Checked In','Waiting','Called','In Consultation') ORDER BY created_at DESC LIMIT 1;`,
      [userId]
    );
    const queue = await this.get(
      `SELECT * FROM queue_tickets WHERE user_id = $1 AND status IN ('Waiting','Called','In Service') ORDER BY created_at DESC LIMIT 1;`,
      [userId]
    );
    return { appointment: appt || null, queue: queue || null };
  }

  async checkAppointmentSlot(department_id, date, time) {
    await this.ready;
    const row = await this.get(
      `SELECT id FROM appointments WHERE department_id = $1 AND date = $2 AND time = $3 AND status != 'Cancelled';`,
      [department_id, date, time]
    );
    return Boolean(row);
  }

  async createAppointment(appt) {
    await this.ready;
    await this.run(
      `INSERT INTO appointments (
        id, appointment_number, user_id, student_name, student_number, department_id, department_name,
        concern, professor, date, time, status, qr_token, created_at, checked_in_at, called_at, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18);`,
      [
        appt.id, appt.appointment_number, appt.user_id, appt.student_name, appt.student_number,
        appt.department_id, appt.department_name, appt.concern, appt.professor, appt.date, appt.time,
        appt.status, appt.qr_token, appt.created_at, appt.checked_in_at || null, appt.called_at || null,
        appt.started_at || null, appt.completed_at || null
      ]
    );
    return appt;
  }

  async getDeptAppointments(deptId) {
    await this.ready;
    const appointments = await this.all(
      `SELECT * FROM appointments WHERE department_id = $1 ORDER BY created_at DESC;`,
      [deptId]
    );
    return {
      appointments,
      stats: {
        total: appointments.length,
        scheduled: appointments.filter(a => a.status === 'Scheduled').length,
        checkedIn: appointments.filter(a => a.status === 'Checked In').length,
        completed: appointments.filter(a => a.status === 'Completed').length
      }
    };
  }

  async getAppointmentById(id) {
    await this.ready;
    return await this.get(`SELECT * FROM appointments WHERE id = $1;`, [id]);
  }

  async updateAppointment(id, fields) {
    await this.ready;
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map((k, idx) => `${k} = $${idx + 1}`).join(', ');
    const values = keys.map(k => fields[k]);
    values.push(id);
    await this.run(`UPDATE appointments SET ${setClause} WHERE id = $${keys.length + 1};`, values);
    return await this.getAppointmentById(id);
  }

  async countQueueTicketsByOffice(officeId) {
    await this.ready;
    const row = await this.get(`SELECT COUNT(*) as count FROM queue_tickets WHERE service_office_id = $1;`, [officeId]);
    return row ? Number(row.count) : 0;
  }

  async countWaitingQueueTickets(officeId) {
    await this.ready;
    const row = await this.get(`SELECT COUNT(*) as count FROM queue_tickets WHERE service_office_id = $1 AND status = 'Waiting';`, [officeId]);
    return row ? Number(row.count) : 0;
  }

  async getNowServingQueueTicket(officeId) {
    await this.ready;
    return await this.get(`SELECT * FROM queue_tickets WHERE service_office_id = $1 AND status = 'Called' LIMIT 1;`, [officeId]);
  }

  async createQueueTicket(ticket) {
    await this.ready;
    await this.run(
      `INSERT INTO queue_tickets (
        id, ticket_number, user_id, student_name, student_number, service_office_id, service_office_name,
        concern, counter, status, position, estimated_wait_min, now_serving, qr_token, created_at, called_at, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18);`,
      [
        ticket.id, ticket.ticket_number, ticket.user_id, ticket.student_name, ticket.student_number,
        ticket.service_office_id, ticket.service_office_name, ticket.concern, ticket.counter || null,
        ticket.status, ticket.position, ticket.estimated_wait_min, ticket.now_serving || null,
        ticket.qr_token, ticket.created_at, ticket.called_at || null, ticket.started_at || null, ticket.completed_at || null
      ]
    );
    return ticket;
  }

  async getServiceRequests(officeId) {
    await this.ready;
    const all = await this.all(`SELECT * FROM queue_tickets WHERE service_office_id = $1 ORDER BY created_at ASC;`, [officeId]);
    const grouped = {};
    all.forEach(q => {
      if (!grouped[q.concern]) grouped[q.concern] = [];
      grouped[q.concern].push(q);
    });
    return {
      officeId,
      requests: all,
      grouped,
      stats: {
        waiting: all.filter(q => q.status === 'Waiting').length,
        inService: all.filter(q => q.status === 'Called' || q.status === 'In Service').length,
        completedToday: all.filter(q => q.status === 'Completed').length
      }
    };
  }

  async getQueueTicketById(id) {
    await this.ready;
    return await this.get(`SELECT * FROM queue_tickets WHERE id = $1;`, [id]);
  }

  async updateQueueTicket(id, fields) {
    await this.ready;
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map((k, idx) => `${k} = $${idx + 1}`).join(', ');
    const values = keys.map(k => fields[k]);
    values.push(id);
    await this.run(`UPDATE queue_tickets SET ${setClause} WHERE id = $${keys.length + 1};`, values);
    return await this.getQueueTicketById(id);
  }

  async getQueueControllerState(officeId) {
    await this.ready;
    const queue = await this.all(`SELECT * FROM queue_tickets WHERE service_office_id = $1 ORDER BY created_at ASC;`, [officeId]);
    const office = await this.getServiceOfficeById(officeId);
    return {
      officeId,
      officeName: office ? office.name : 'Treasury',
      nowServing: queue.find(q => q.status === 'Called' || q.status === 'In Service') || null,
      waitingList: queue.filter(q => q.status === 'Waiting')
    };
  }

  async createTransaction(tx) {
    await this.ready;
    await this.run(
      `INSERT INTO transactions (id, date, entity_name, concern, reference_number, type, student_name, status, waiting_duration, service_duration, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
      [tx.id, tx.date, tx.entity_name, tx.concern, tx.reference_number, tx.type, tx.student_name, tx.status, tx.waiting_duration, tx.service_duration, tx.created_at || new Date().toISOString()]
    );
    return tx;
  }

  async getTransactions() {
    await this.ready;
    return await this.all(`SELECT * FROM transactions ORDER BY created_at DESC;`);
  }

  async getAnalytics() {
    await this.ready;
    const totalAppts = await this.get(`SELECT COUNT(*) as count FROM appointments;`);
    const totalTickets = await this.get(`SELECT COUNT(*) as count FROM queue_tickets;`);
    const totalCompleted = await this.get(`SELECT COUNT(*) as count FROM transactions WHERE status = 'Completed';`);
    const usersCount = await this.get(`SELECT COUNT(*) as count FROM users WHERE role = 'student';`);
    return {
      totalAppointments: totalAppts ? Number(totalAppts.count) : 0,
      totalQueueTickets: totalTickets ? Number(totalTickets.count) : 0,
      totalCompletedTransactions: totalCompleted ? Number(totalCompleted.count) : 0,
      registeredStudents: usersCount ? Number(usersCount.count) : 0,
      averageWaitTime: '12.5 mins',
      serviceEfficiency: '94.2%'
    };
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

module.exports = new Database();
