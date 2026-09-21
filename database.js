// database.js — Supabase PostgreSQL Database Store for Q-Less with In-Memory Fallback
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;

class Database {
  constructor() {
    this.memoryStore = {
      users: [],
      students: [],
      departmental_staff: [],
      service_staff: [],
      departments: [],
      professors: [],
      dept_concerns: [],
      service_offices: [],
      service_concerns: [],
      appointments: [],
      queue_tickets: [],
      transactions: [],
      notifications: []
    };

    if (connectionString) {
      console.log('Connecting to PostgreSQL database via connection string...');
      this.pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
      });
      this.ready = this.initSchema();
    } else {
      console.log('No DATABASE_URL supplied; using in-memory store for local development.');
      this.pool = null;
      this.ready = this.initSchema();
    }
  }

  translateSql(sql) {
    let paramIndex = 1;
    let translated = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    translated = translated.replace(/\?/g, () => `$${paramIndex++}`);
    return translated;
  }

  async query(sql, params = []) {
    if (!this.pool) return { rows: [] };
    const pgSql = this.translateSql(sql);
    return await this.pool.query(pgSql, params);
  }

  async run(sql, params = []) {
    if (!this.pool) return { rows: [] };
    return await this.query(sql, params);
  }

  async get(sql, params = []) {
    if (!this.pool) return null;
    const res = await this.query(sql, params);
    return (res && res.rows && res.rows.length > 0) ? res.rows[0] : null;
  }

  async all(sql, params = []) {
    if (!this.pool) return [];
    const res = await this.query(sql, params);
    return (res && res.rows) ? res.rows : [];
  }

  async initSchema() {
    if (this.pool) {
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
    }

    await this.seedDefaultData();
    await this.seedDemoAccounts();
  }

  async seedDefaultData() {
    // Populate Memory Store / Postgres Seed
    const depts = [
      { id: 'dept-soit', name: 'School of Information Technology', code: 'SOIT', active: true },
      { id: 'dept-smda', name: 'School of Multimedia and Digital Arts', code: 'SMDA', active: false },
      { id: 'dept-etysb', name: 'E.T. Yuchengco School of Business', code: 'ETYSB', active: false },
      { id: 'dept-shs', name: 'School of Health Sciences', code: 'SHS', active: false },
      { id: 'dept-sn', name: 'School of Nursing', code: 'SN', active: false },
      { id: 'dept-som', name: 'School of Medicine', code: 'SOM', active: false }
    ];
    this.memoryStore.departments = depts;

    this.memoryStore.professors = [
      { id: 'none', name: 'None (No specific professor)' },
      { id: 'p1', name: 'Anne Curtis' },
      { id: 'p2', name: 'Kathryn Bernardo' },
      { id: 'p3', name: 'Nadine Lustre' },
      { id: 'p4', name: 'Bea Alonzo' },
      { id: 'p5', name: 'Julia Barretto' }
    ];

    this.memoryStore.dept_concerns = [
      'Grade Consultation',
      'Lecture Consultation',
      'Academic Advising',
      'Enrollment / Academic Concern',
      'Meeting with a Professor'
    ];

    const offices = [
      { id: 'office-admissions', name: 'Admissions', active: true },
      { id: 'office-treasury', name: 'Treasury', active: true },
      { id: 'office-registrar', name: 'Registrar', active: true },
      { id: 'office-accounting', name: 'Accounting', active: true },
      { id: 'office-cashier', name: 'Cashier', active: true },
      { id: 'office-sa', name: 'Student Affairs', active: true },
      { id: 'office-doit', name: 'DO-IT / IT Helpdesk', active: true },
      { id: 'office-other', name: 'Other Services', active: true }
    ];
    this.memoryStore.service_offices = offices;

    this.memoryStore.service_concerns = [];
    offices.forEach(off => {
      ['General Inquiry', 'Document Request', 'Payment / Assessment', 'Processing Concern', 'Other'].forEach(c => {
        this.memoryStore.service_concerns.push({ office_id: off.id, concern: c });
      });
    });
  }

  async seedDemoAccounts() {
    const now = new Date().toISOString();

    // Student Demo
    const stHash = await bcrypt.hash('student123', 10);
    const stUser = {
      id: 'u-student-demo',
      full_name: 'Demo Student',
      student_number: '2023100001',
      email: 'studentdemo@mymail.mapua.edu.ph',
      password_hash: stHash,
      role: 'student',
      school: 'School of Information Technology',
      created_at: now
    };

    // Department Demo
    const deptHash = await bcrypt.hash('department123', 10);
    const deptUser = {
      id: 'u-dept-demo',
      full_name: 'Department Staff',
      student_number: null,
      email: 'departmental@mapua.edu.ph',
      password_hash: deptHash,
      role: 'department',
      department: 'School of Information Technology',
      created_at: now
    };

    // Service Demo
    const svcHash = await bcrypt.hash('service123', 10);
    const svcUser = {
      id: 'u-service-demo',
      full_name: 'Service Staff',
      student_number: null,
      email: 'service@mapua.edu.ph',
      password_hash: svcHash,
      role: 'service',
      service_office: 'Treasury',
      created_at: now
    };

    // Seed into Postgres if database pool is available
    if (this.pool) {
      const existingStudent = await this.get(`SELECT id FROM users WHERE LOWER(email) = LOWER($1);`, [stUser.email]);
      if (!existingStudent) {
        await this.run(
          `INSERT INTO users (id, full_name, student_number, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
          [stUser.id, stUser.full_name, stUser.student_number, stUser.email, stUser.password_hash, stUser.role, stUser.created_at]
        );
        await this.run(`INSERT INTO students (user_id, school) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET school = EXCLUDED.school;`, [stUser.id, stUser.school]);
      }

      const existingDept = await this.get(`SELECT id FROM users WHERE LOWER(email) = LOWER($1);`, [deptUser.email]);
      if (!existingDept) {
        await this.run(
          `INSERT INTO users (id, full_name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6);`,
          [deptUser.id, deptUser.full_name, deptUser.email, deptUser.password_hash, deptUser.role, deptUser.created_at]
        );
        await this.run(`INSERT INTO departmental_staff (user_id, department) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET department = EXCLUDED.department;`, [deptUser.id, deptUser.department]);
      }

      const existingSvc = await this.get(`SELECT id FROM users WHERE LOWER(email) = LOWER($1);`, [svcUser.email]);
      if (!existingSvc) {
        await this.run(
          `INSERT INTO users (id, full_name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6);`,
          [svcUser.id, svcUser.full_name, svcUser.email, svcUser.password_hash, svcUser.role, svcUser.created_at]
        );
        await this.run(`INSERT INTO service_staff (user_id, service_office) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET service_office = EXCLUDED.service_office;`, [svcUser.id, svcUser.service_office]);
      }
    }

    // Always ensure memory store contains demo accounts
    this.memoryStore.users = this.memoryStore.users.filter(u => ![stUser.email, deptUser.email, svcUser.email].includes(u.email));
    this.memoryStore.users.push(stUser, deptUser, svcUser);
    this.memoryStore.students.push({ user_id: stUser.id, school: stUser.school });
    this.memoryStore.departmental_staff.push({ user_id: deptUser.id, department: deptUser.department });
    this.memoryStore.service_staff.push({ user_id: svcUser.id, service_office: svcUser.service_office });
  }

  // ── Database Query Helper Methods ──────────────────────────────────────

  async findUserByEmail(email) {
    await this.ready;
    if (!email) return null;
    const cleanEmail = email.trim().toLowerCase();

    if (this.pool) {
      const user = await this.get(`SELECT * FROM users WHERE LOWER(email) = LOWER($1);`, [cleanEmail]);
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
    } else {
      const user = this.memoryStore.users.find(u => u.email.toLowerCase() === cleanEmail);
      if (!user) return null;
      return { ...user };
    }
  }

  async createUser(user) {
    await this.ready;
    if (this.pool) {
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
    }

    // Also update in-memory store
    this.memoryStore.users.push({ ...user });
    if (user.role === 'student') this.memoryStore.students.push({ user_id: user.id, school: user.school });
    if (user.role === 'department') this.memoryStore.departmental_staff.push({ user_id: user.id, department: user.department });
    if (user.role === 'service') this.memoryStore.service_staff.push({ user_id: user.id, service_office: user.service_office });

    return user;
  }

  async getDepartments() {
    await this.ready;
    if (this.pool) {
      const rows = await this.all(`SELECT id, name, code, active FROM departments ORDER BY name ASC;`);
      return rows.map(r => ({ ...r, active: Boolean(r.active) }));
    }
    return this.memoryStore.departments;
  }

  async getDepartmentById(id) {
    await this.ready;
    if (this.pool) {
      const row = await this.get(`SELECT id, name, code, active FROM departments WHERE id = $1;`, [id]);
      if (!row) return null;
      return { ...row, active: Boolean(row.active) };
    }
    const d = this.memoryStore.departments.find(dept => dept.id === id || dept.name.toLowerCase() === id.toLowerCase());
    return d ? { ...d } : null;
  }

  async getProfessors() {
    await this.ready;
    if (this.pool) return await this.all(`SELECT id, name FROM professors;`);
    return this.memoryStore.professors;
  }

  async getDeptConcerns() {
    await this.ready;
    if (this.pool) {
      const rows = await this.all(`SELECT concern FROM dept_concerns;`);
      return rows.map(r => r.concern);
    }
    return this.memoryStore.dept_concerns;
  }

  async getServiceOffices() {
    await this.ready;
    if (this.pool) {
      const rows = await this.all(`SELECT id, name, active FROM service_offices;`);
      return rows.map(r => ({ ...r, active: Boolean(r.active) }));
    }
    return this.memoryStore.service_offices;
  }

  async getServiceOfficeById(id) {
    await this.ready;
    if (this.pool) {
      const row = await this.get(`SELECT id, name, active FROM service_offices WHERE id = $1 OR LOWER(name) = LOWER($2);`, [id, id.toLowerCase()]);
      if (!row) return null;
      return { ...row, active: Boolean(row.active) };
    }
    const off = this.memoryStore.service_offices.find(o => o.id === id || o.name.toLowerCase() === id.toLowerCase());
    return off ? { ...off } : null;
  }

  async getServiceConcernsMap() {
    await this.ready;
    if (this.pool) {
      const rows = await this.all(`SELECT office_id, concern FROM service_concerns;`);
      const map = {};
      rows.forEach(r => {
        if (!map[r.office_id]) map[r.office_id] = [];
        map[r.office_id].push(r.concern);
      });
      return map;
    }
    const map = {};
    this.memoryStore.service_concerns.forEach(r => {
      if (!map[r.office_id]) map[r.office_id] = [];
      map[r.office_id].push(r.concern);
    });
    return map;
  }

  async getActiveRequests(userId) {
    await this.ready;
    if (this.pool) {
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
    const appt = this.memoryStore.appointments.find(a => a.user_id === userId && ['Scheduled','Checked In','Waiting','Called','In Consultation'].includes(a.status));
    const queue = this.memoryStore.queue_tickets.find(q => q.user_id === userId && ['Waiting','Called','In Service'].includes(q.status));
    return { appointment: appt || null, queue: queue || null };
  }

  async checkAppointmentSlot(department_id, date, time) {
    await this.ready;
    if (this.pool) {
      const row = await this.get(
        `SELECT id FROM appointments WHERE department_id = $1 AND date = $2 AND time = $3 AND status != 'Cancelled';`,
        [department_id, date, time]
      );
      return Boolean(row);
    }
    return Boolean(this.memoryStore.appointments.find(a => a.department_id === department_id && a.date === date && a.time === time && a.status !== 'Cancelled'));
  }

  async createAppointment(appt) {
    await this.ready;
    if (this.pool) {
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
    }
    this.memoryStore.appointments.push(appt);
    return appt;
  }

  async getDeptAppointments(deptId) {
    await this.ready;
    let appointments = [];
    if (this.pool) {
      appointments = await this.all(`SELECT * FROM appointments WHERE department_id = $1 ORDER BY created_at DESC;`, [deptId]);
    } else {
      appointments = this.memoryStore.appointments.filter(a => a.department_id === deptId || deptId === 'dept-soit');
    }
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
    if (this.pool) return await this.get(`SELECT * FROM appointments WHERE id = $1;`, [id]);
    return this.memoryStore.appointments.find(a => a.id === id) || null;
  }

  async updateAppointment(id, fields) {
    await this.ready;
    if (this.pool) {
      const keys = Object.keys(fields);
      if (keys.length === 0) return;
      const setClause = keys.map((k, idx) => `${k} = $${idx + 1}`).join(', ');
      const values = keys.map(k => fields[k]);
      values.push(id);
      await this.run(`UPDATE appointments SET ${setClause} WHERE id = $${keys.length + 1};`, values);
      return await this.getAppointmentById(id);
    }
    const appt = this.memoryStore.appointments.find(a => a.id === id);
    if (appt) Object.assign(appt, fields);
    return appt;
  }

  async countQueueTicketsByOffice(officeId) {
    await this.ready;
    if (this.pool) {
      const row = await this.get(`SELECT COUNT(*) as count FROM queue_tickets WHERE service_office_id = $1;`, [officeId]);
      return row ? Number(row.count) : 0;
    }
    return this.memoryStore.queue_tickets.filter(q => q.service_office_id === officeId).length;
  }

  async countWaitingQueueTickets(officeId) {
    await this.ready;
    if (this.pool) {
      const row = await this.get(`SELECT COUNT(*) as count FROM queue_tickets WHERE service_office_id = $1 AND status = 'Waiting';`, [officeId]);
      return row ? Number(row.count) : 0;
    }
    return this.memoryStore.queue_tickets.filter(q => q.service_office_id === officeId && q.status === 'Waiting').length;
  }

  async getNowServingQueueTicket(officeId) {
    await this.ready;
    if (this.pool) return await this.get(`SELECT * FROM queue_tickets WHERE service_office_id = $1 AND status IN ('Called', 'In Service') LIMIT 1;`, [officeId]);
    return this.memoryStore.queue_tickets.find(q => q.service_office_id === officeId && ['Called', 'In Service'].includes(q.status)) || null;
  }

  async createQueueTicket(ticket) {
    await this.ready;
    if (this.pool) {
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
    }
    this.memoryStore.queue_tickets.push(ticket);
    return ticket;
  }

  async getServiceRequests(officeId) {
    await this.ready;
    let all = [];
    if (this.pool) {
      all = await this.all(`SELECT * FROM queue_tickets WHERE service_office_id = $1 ORDER BY created_at ASC;`, [officeId]);
    } else {
      all = this.memoryStore.queue_tickets.filter(q => q.service_office_id === officeId || officeId === 'office-treasury');
    }
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
    if (this.pool) return await this.get(`SELECT * FROM queue_tickets WHERE id = $1;`, [id]);
    return this.memoryStore.queue_tickets.find(q => q.id === id) || null;
  }

  async updateQueueTicket(id, fields) {
    await this.ready;
    if (this.pool) {
      const keys = Object.keys(fields);
      if (keys.length === 0) return;
      const setClause = keys.map((k, idx) => `${k} = $${idx + 1}`).join(', ');
      const values = keys.map(k => fields[k]);
      values.push(id);
      await this.run(`UPDATE queue_tickets SET ${setClause} WHERE id = $${keys.length + 1};`, values);
      return await this.getQueueTicketById(id);
    }
    const ticket = this.memoryStore.queue_tickets.find(q => q.id === id);
    if (ticket) Object.assign(ticket, fields);
    return ticket;
  }

  async getQueueControllerState(officeId) {
    await this.ready;
    let queue = [];
    let office = null;

    if (this.pool) {
      queue = await this.all(`SELECT * FROM queue_tickets WHERE service_office_id = $1 ORDER BY created_at ASC;`, [officeId]);
      office = await this.getServiceOfficeById(officeId);
    } else {
      queue = this.memoryStore.queue_tickets.filter(q => q.service_office_id === officeId || officeId === 'office-treasury');
      office = this.memoryStore.service_offices.find(o => o.id === officeId) || { name: 'Treasury' };
    }

    return {
      officeId,
      officeName: office ? office.name : 'Treasury',
      nowServing: queue.find(q => q.status === 'Called' || q.status === 'In Service') || null,
      waitingList: queue.filter(q => q.status === 'Waiting')
    };
  }

  async createTransaction(tx) {
    await this.ready;
    if (this.pool) {
      await this.run(
        `INSERT INTO transactions (id, date, entity_name, concern, reference_number, type, student_name, status, waiting_duration, service_duration, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
        [tx.id, tx.date, tx.entity_name, tx.concern, tx.reference_number, tx.type, tx.student_name, tx.status, tx.waiting_duration, tx.service_duration, tx.created_at || new Date().toISOString()]
      );
    }
    this.memoryStore.transactions.push(tx);
    return tx;
  }

  async getTransactions() {
    await this.ready;
    if (this.pool) return await this.all(`SELECT * FROM transactions ORDER BY created_at DESC;`);
    return this.memoryStore.transactions;
  }

  async getAnalytics() {
    await this.ready;
    if (this.pool) {
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
    return {
      totalAppointments: this.memoryStore.appointments.length,
      totalQueueTickets: this.memoryStore.queue_tickets.length,
      totalCompletedTransactions: this.memoryStore.transactions.filter(t => t.status === 'Completed').length,
      registeredStudents: this.memoryStore.users.filter(u => u.role === 'student').length,
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
