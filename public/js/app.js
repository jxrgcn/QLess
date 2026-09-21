/* ===================================================================
   Q-Less app.js — Complete Frontend Logic
   Mapúa University Digital Appointment and Queue Management System
   =================================================================== */

/* ── QR Generation (inline minimal QR using qrcodejs CDN) ─────────── */
(function loadQR() {
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  script.onerror = () => {
    window.QRCodeFallback = true;
    console.warn('QR library not loaded — using fallback canvas.');
  };
  document.head.appendChild(script);
})();

/* ── Helpers ─────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const $q = sel => document.querySelector(sel);

function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }
function err(el, msg) { if (el) { el.textContent = msg; show(el); } }
function clearErr(el) { if (el) { el.textContent = ''; hide(el); } }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusBadge(s) {
  const map = {
    'Scheduled': 'badge-gray',
    'Waiting': 'badge-yellow',
    'Called': 'badge-red',
    'Checked In': 'badge-yellow',
    'In Consultation': 'badge-yellow',
    'In Service': 'badge-yellow',
    'Completed': 'badge-green',
    'Cancelled': 'badge-gray',
    'Skipped': 'badge-gray'
  };
  return `<span class="badge ${map[s] || 'badge-gray'}">${s}</span>`;
}

function toast(title, body, ms = 5000) {
  const t = $('notification-toast');
  $('toast-title').textContent = title;
  $('toast-body').textContent = body;
  show(t);
  clearTimeout(t._timer);
  t._timer = setTimeout(() => hide(t), ms);
}

function generateQR(canvasId, text, size = 150) {
  const canvas = $(canvasId);
  if (!canvas) return;
  canvas.innerHTML = '';
  if (window.QRCode) {
    canvas.innerHTML = '';
    try {
      new window.QRCode(canvas, {
        text: text || 'QL-DEMO',
        width: size,
        height: size,
        colorDark: '#000000',
        colorLight: '#FFFFFF',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } catch (e) { drawFallbackQR(canvas, text); }
  } else {
    setTimeout(() => generateQR(canvasId, text, size), 600);
  }
}

function drawFallbackQR(canvas, text) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const sz = canvas.width || 150;
  ctx.clearRect(0, 0, sz, sz);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sz, sz);
  const cells = 21;
  const cs = Math.floor(sz / cells);
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const hash = (r * 13 + c * 7 + (text ? text.charCodeAt(r % text.length) : 0)) % 3;
      if (hash === 0 || (r < 8 && (c < 8 || c >= cells - 8)) || (r >= cells - 8 && c < 8)) {
        ctx.fillStyle = '#000';
        ctx.fillRect(c * cs, r * cs, cs, cs);
      }
    }
  }
}

function downloadQR(canvasId, filename) {
  const el = $(canvasId);
  if (!el) return;
  const cvs = el.querySelector('canvas') || el;
  if (!cvs || !cvs.toDataURL) { toast('Download', 'Cannot download QR at this time.'); return; }
  const a = document.createElement('a');
  a.href = cvs.toDataURL('image/png');
  a.download = filename || 'qr-code.png';
  a.click();
}

/* ── View Router ─────────────────────────────────────────────────── */
const VIEWS = [
  'landing','student-login','student-register','student-dashboard',
  'dept-flow','service-flow','student-history',
  'staff-access','dept-login','services-login',
  'dept-dashboard','services-dashboard',
  'tv-select','tv-display'
];

let currentView = 'landing';
let currentUser = null;
let socket = null;

function goTo(viewName) {
  if (!VIEWS.includes(viewName)) return;

  // Unauthenticated user route protection
  if (!currentUser) {
    const protectedViews = ['student-dashboard', 'dept-flow', 'service-flow', 'student-history', 'dept-dashboard', 'services-dashboard', 'tv-select', 'tv-display'];
    if (protectedViews.includes(viewName)) {
      toast('Login Required', 'Please log in to access this feature.');
      if (viewName === 'dept-dashboard') return renderDeptLogin();
      if (viewName === 'services-dashboard' || viewName === 'tv-select' || viewName === 'tv-display') return renderServicesLogin();
      return goTo('student-login');
    }
  }

  // Role-based navigation guard
  if (currentUser) {
    const role = currentUser.role;
    const studentViews = ['student-dashboard', 'dept-flow', 'service-flow', 'student-history'];
    const deptViews = ['dept-dashboard', 'dept-login'];
    const serviceViews = ['services-dashboard', 'services-login', 'tv-select', 'tv-display'];

    if (role === 'student' && (deptViews.includes(viewName) || serviceViews.includes(viewName) || viewName === 'staff-access')) {
      toast('Access Denied', 'You cannot access staff portals as a student.');
      return goTo('student-dashboard');
    }
    if ((role === 'department' || role === 'dept_secretary') && (studentViews.includes(viewName) || serviceViews.includes(viewName))) {
      toast('Access Denied', 'You are logged in as Departmental Staff.');
      return goTo('dept-dashboard');
    }
    if ((role === 'service' || role === 'services_staff') && (studentViews.includes(viewName) || deptViews.includes(viewName))) {
      toast('Access Denied', 'You are logged in as Service Office Staff.');
      return goTo('services-dashboard');
    }
  }

  VIEWS.forEach(v => {
    const el = $(`view-${v}`);
    if (el) el.classList.toggle('active-view', v === viewName);
    if (el) el.classList.toggle('hidden', v !== viewName);
  });
  currentView = viewName;
  window.location.hash = viewName;
  updateNav();
  onViewEnter(viewName);
}

function updateNav() {
  const nav = $('main-nav-links');
  if (!nav) return;
  nav.innerHTML = '';
  if (!currentUser) return;

  const role = currentUser.role;
  let links = [];

  if (role === 'student') {
    links = [
      { label: 'Dashboard', view: 'student-dashboard' },
      { label: 'Book Appointment', view: 'dept-flow' },
      { label: 'Get Queue Ticket', view: 'service-flow' },
      { label: 'History', view: 'student-history' }
    ];
  } else if (role === 'department' || role === 'dept_secretary') {
    links = [{ label: 'Appointment Manager', view: 'dept-dashboard' }];
  } else if (role === 'service' || role === 'services_staff') {
    links = [{ label: 'Queue Manager', view: 'services-dashboard' }];
  }

  links.forEach(l => {
    const a = document.createElement('a');
    a.className = 'nav-link' + (currentView === l.view ? ' active' : '');
    a.href = '#';
    a.textContent = l.label;
    a.addEventListener('click', e => { e.preventDefault(); goTo(l.view); });
    nav.appendChild(a);
  });

  // Logout
  const logoutA = document.createElement('a');
  logoutA.className = 'nav-link';
  logoutA.href = '#';
  logoutA.textContent = 'Sign Out';
  logoutA.style.color = 'var(--color-primary)';
  logoutA.addEventListener('click', e => { e.preventDefault(); logout(); });
  nav.appendChild(logoutA);
}

/* ── View Enter Callbacks ────────────────────────────────────────── */
function onViewEnter(v) {
  if (v === 'landing') renderLanding();
  if (v === 'student-login' || v === 'dept-login' || v === 'services-login') setupPortalLogin();
  if (v === 'student-register') setupPortalRegister();
  if (v === 'student-dashboard') renderStudentDashboard();
  if (v === 'dept-flow') resetDeptFlow();
  if (v === 'service-flow') resetServiceFlow();
  if (v === 'student-history') renderHistory();
  if (v === 'dept-dashboard') renderDeptDashboard();
  if (v === 'services-dashboard') renderServicesDashboard();
  if (v === 'tv-select') renderTVSelect();
  if (v === 'tv-display') startTVDisplay();
}

/* ── Real-time Socket.IO Connection ────────────────────────────── */
function initSocket() {
  if (typeof io !== 'undefined' && !socket) {
    socket = io();
    console.log('Real-time Socket.IO connected.');

    if (currentUser && currentUser.id) {
      socket.emit('join_user_room', currentUser.id);
      if (currentUser.department_id) {
        socket.emit('join_department_room', currentUser.department_id);
      }
    }

    socket.on('queue_updated', (data) => {
      console.log('Real-time queue_updated event received:', data);
      if (currentView === 'student-dashboard') renderStudentDashboard();
      if (currentView === 'services-dashboard') renderServicesDashboard();
      if (currentView === 'tv-display' && typeof startTVDisplay === 'function') startTVDisplay();
    });

    socket.on('dept_appointment_updated', (data) => {
      console.log('Real-time dept_appointment_updated event received:', data);
      if (currentView === 'student-dashboard') renderStudentDashboard();
      if (currentView === 'dept-dashboard') renderDeptDashboard();
    });

    socket.on('appointment_created', (data) => {
      console.log('Real-time appointment_created event received:', data);
      if (currentView === 'student-dashboard') renderStudentDashboard();
      if (currentView === 'dept-dashboard') renderDeptDashboard();
    });

    socket.on('student_notification', (data) => {
      console.log('Real-time student_notification event received:', data);
      if (!currentUser || currentUser.role === 'student') {
        if (!data.user_id || (currentUser && currentUser.id === data.user_id)) {
          toast(data.title, data.message, 8000);
          if (currentView === 'student-dashboard') renderStudentDashboard();
        }
      }
    });
  } else if (socket && currentUser && currentUser.id) {
    socket.emit('join_user_room', currentUser.id);
    if (currentUser.department_id) {
      socket.emit('join_department_room', currentUser.department_id);
    }
  }
}

/* ── Auth ────────────────────────────────────────────────────────── */
async function checkSession() {
  try {
    const data = await api('GET', '/api/auth/me');
    if (data.loggedIn) {
      currentUser = data.user;
      initSocket();
      routeByRole();
    } else {
      goTo('landing');
    }
  } catch {
    goTo('landing');
  }
}

function routeByRole() {
  if (!currentUser) return goTo('landing');
  if (currentUser.role === 'student') return goTo('student-dashboard');
  if (currentUser.role === 'department' || currentUser.role === 'dept_secretary') return goTo('dept-dashboard');
  if (currentUser.role === 'service' || currentUser.role === 'services_staff') return goTo('services-dashboard');
}

async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch (e) {}
  currentUser = null;
  updateNav();
  goTo('landing');
}

/* ── Landing ─────────────────────────────────────────────────────── */
function renderLanding() {
  // Nothing dynamic — static HTML
}

/* ── Unified Multi-Portal Login ───────────────────────────────────── */
function setupPortalLogin() {
  bindPortalLoginTabs();
  bindUnifiedLoginBtn();
}

function bindPortalLoginTabs() {
  document.querySelectorAll('.portal-tab-btn').forEach(btn => {
    if (btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', () => {
      const portal = btn.dataset.portal;
      document.querySelectorAll('.portal-tab-btn').forEach(b => {
        const isActive = b.dataset.portal === portal;
        b.classList.toggle('active', isActive);
        b.style.background = isActive ? 'var(--color-primary)' : 'white';
        b.style.color = isActive ? 'white' : 'var(--color-text-secondary)';
        b.style.borderColor = isActive ? 'var(--color-primary)' : 'var(--color-border)';
      });

      const typeInput = $('login-portal-type');
      if (typeInput) typeInput.value = portal;

      const hint = $('login-domain-hint');
      const emailInput = $('login-email');
      const subtitle = $('login-portal-subtitle');
      const demoContent = $('demo-credentials-content');

      if (portal === 'student') {
        if (hint) hint.textContent = '(@mymail.mapua.edu.ph)';
        if (emailInput) emailInput.placeholder = 'studentdemo@mymail.mapua.edu.ph';
        if (subtitle) subtitle.textContent = 'Sign in to Mapúa Student Portal';
        if (demoContent) demoContent.innerHTML = '<strong>Email:</strong> <code>studentdemo@mymail.mapua.edu.ph</code><br><strong>Password:</strong> <code>student123</code>';
      } else if (portal === 'department') {
        if (hint) hint.textContent = '(@mapua.edu.ph)';
        if (emailInput) emailInput.placeholder = 'departmental@mapua.edu.ph';
        if (subtitle) subtitle.textContent = 'Sign in to Departmental Portal';
        if (demoContent) demoContent.innerHTML = '<strong>Email:</strong> <code>departmental@mapua.edu.ph</code><br><strong>Password:</strong> <code>department123</code>';
      } else if (portal === 'service') {
        if (hint) hint.textContent = '(@mapua.edu.ph)';
        if (emailInput) emailInput.placeholder = 'service@mapua.edu.ph';
        if (subtitle) subtitle.textContent = 'Sign in to Service Office Portal';
        if (demoContent) demoContent.innerHTML = '<strong>Email:</strong> <code>service@mapua.edu.ph</code><br><strong>Password:</strong> <code>service123</code>';
      }
    });
  });
}

function bindUnifiedLoginBtn() {
  const btn = $('login-btn');
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener('click', async () => {
    const portal_type = $('login-portal-type') ? $('login-portal-type').value : 'student';
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    const errEl = $('login-error');
    clearErr(errEl);

    if (!email || !password) return err(errEl, 'Please enter your email address and password.');

    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const data = await api('POST', '/api/auth/login', { portal_type, email, password });
      currentUser = data.user;
      initSocket();
      routeByRole();
    } catch (e) { err(errEl, e.message); }
    finally { btn.disabled = false; btn.textContent = 'Log In'; }
  });
}

/* ── Multi-Portal Registration Setup ──────────────────────────────── */
function setupPortalRegister() {
  bindPortalRegisterTabs();
  bindStudentRegisterBtn();
  bindDeptRegisterBtn();
  bindServiceRegisterBtn();
}

function bindPortalRegisterTabs() {
  document.querySelectorAll('.reg-tab-btn').forEach(btn => {
    if (btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', () => {
      const regtype = btn.dataset.regtype;
      document.querySelectorAll('.reg-tab-btn').forEach(b => {
        const isActive = b.dataset.regtype === regtype;
        b.classList.toggle('active', isActive);
        b.style.background = isActive ? 'var(--color-primary)' : 'white';
        b.style.color = isActive ? 'white' : 'var(--color-text-secondary)';
        b.style.borderColor = isActive ? 'var(--color-primary)' : 'var(--color-border)';
      });

      const stForm = $('form-reg-student');
      const deptForm = $('form-reg-dept');
      const svcForm = $('form-reg-svc');

      if (stForm) stForm.classList.toggle('hidden', regtype !== 'student');
      if (deptForm) deptForm.classList.toggle('hidden', regtype !== 'department');
      if (svcForm) svcForm.classList.toggle('hidden', regtype !== 'service');
    });
  });
}

function bindStudentRegisterBtn() {
  const btn = $('register-btn');
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener('click', async () => {
    const errEl = $('register-error');
    clearErr(errEl);
    const full_name = $('reg-name').value.trim();
    const email = $('reg-email').value.trim();
    const password = $('reg-password').value;
    const confirm_password = $('reg-confirm').value;
    const school = $('reg-school').value;

    if (!full_name || !email || !password || !confirm_password || !school)
      return err(errEl, 'Please fill in all fields.');

    if (!email.toLowerCase().endsWith('@mymail.mapua.edu.ph'))
      return err(errEl, 'Student email must end with @mymail.mapua.edu.ph.');

    if (password !== confirm_password)
      return err(errEl, 'Passwords do not match.');

    if (school !== 'School of Information Technology')
      return err(errEl, 'Only School of Information Technology is available for student registration at this time.');

    btn.disabled = true; btn.textContent = 'Creating account…';
    try {
      const data = await api('POST', '/api/auth/register-student', { full_name, email, password, confirm_password, school });
      currentUser = data.user;
      initSocket();
      routeByRole();
    } catch (e) { err(errEl, e.message); }
    finally { btn.disabled = false; btn.textContent = 'Register Student Account'; }
  });
}

function bindDeptRegisterBtn() {
  const btn = $('reg-dept-btn');
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener('click', async () => {
    const errEl = $('reg-dept-error');
    clearErr(errEl);
    const full_name = $('reg-dept-name').value.trim();
    const email = $('reg-dept-email').value.trim();
    const password = $('reg-dept-pass').value;
    const confirm_password = $('reg-dept-confirm').value;
    const department = $('reg-dept-select').value;

    if (!full_name || !email || !password || !confirm_password || !department)
      return err(errEl, 'Please fill in all fields.');

    if (!email.toLowerCase().endsWith('@mapua.edu.ph'))
      return err(errEl, 'Departmental staff email must end with @mapua.edu.ph.');

    if (password !== confirm_password)
      return err(errEl, 'Passwords do not match.');

    btn.disabled = true; btn.textContent = 'Registering…';
    try {
      const data = await api('POST', '/api/auth/register-department', { full_name, email, password, confirm_password, department });
      currentUser = data.user;
      initSocket();
      routeByRole();
    } catch (e) { err(errEl, e.message); }
    finally { btn.disabled = false; btn.textContent = 'Register Department Staff'; }
  });
}

function bindServiceRegisterBtn() {
  const btn = $('reg-svc-btn');
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener('click', async () => {
    const errEl = $('reg-svc-error');
    clearErr(errEl);
    const full_name = $('reg-svc-name').value.trim();
    const email = $('reg-svc-email').value.trim();
    const password = $('reg-svc-pass').value;
    const confirm_password = $('reg-svc-confirm').value;
    const service_office = $('reg-svc-select').value;

    if (!full_name || !email || !password || !confirm_password || !service_office)
      return err(errEl, 'Please fill in all fields.');

    if (!email.toLowerCase().endsWith('@mapua.edu.ph'))
      return err(errEl, 'Service office staff email must end with @mapua.edu.ph.');

    if (password !== confirm_password)
      return err(errEl, 'Passwords do not match.');

    btn.disabled = true; btn.textContent = 'Registering…';
    try {
      const data = await api('POST', '/api/auth/register-service', { full_name, email, password, confirm_password, service_office });
      currentUser = data.user;
      initSocket();
      routeByRole();
    } catch (e) { err(errEl, e.message); }
    finally { btn.disabled = false; btn.textContent = 'Register Service Staff'; }
  });
}

/* ── Student Dashboard ───────────────────────────────────────────── */
async function renderStudentDashboard() {
  if (!currentUser) return;
  const nameEl = $('dashboard-name');
  if (nameEl) nameEl.textContent = currentUser.full_name ? currentUser.full_name.split(' ')[0] : 'Student';

  // Active requests banner
  try {
    const d = await api('GET', '/api/student/active-requests');
    const banner = $('active-requests-banner');
    const bannerText = $('active-banner-text');
    const bannerBtn = $('active-banner-btn');

    if (d.appointment && d.queue) {
      show(banner);
      bannerText.textContent = `Appointment ${d.appointment.appointment_number} (${d.appointment.status}) · Queue ${d.queue.ticket_number} (${d.queue.status})`;
      bannerBtn.onclick = () => goTo('dept-flow');
    } else if (d.appointment) {
      show(banner);
      bannerText.textContent = `Appointment ${d.appointment.appointment_number} — ${d.appointment.status} · ${d.appointment.department_name}`;
      bannerBtn.onclick = () => goTo('dept-flow');
    } else if (d.queue) {
      show(banner);
      bannerText.textContent = `Queue ticket ${d.queue.ticket_number} — ${d.queue.status} · ${d.queue.service_office_name}`;
      bannerBtn.onclick = () => goTo('service-flow');
    } else {
      hide(banner);
    }
  } catch (e) { hide($('active-requests-banner')); }

  // History table preview
  try {
    const d = await api('GET', '/api/student/history');
    const tbody = $('dashboard-history-table');
    const rows = d.transactions.slice(0, 5);
    if (!rows.length) { tbody.innerHTML = '<p style="font-size:13px;color:var(--color-text-muted);text-align:center;padding:20px;">No transactions yet.</p>'; return; }
    tbody.innerHTML = `<div class="table-responsive"><table class="table">
      <thead><tr><th>Date</th><th>Reference</th><th>Office / Dept</th><th>Concern</th><th>Status</th></tr></thead>
      <tbody>${rows.map(t => `<tr>
        <td>${t.date || '—'}</td>
        <td style="font-weight:700;">${t.reference_number}</td>
        <td>${t.entity_name}</td>
        <td>${t.concern}</td>
        <td>${statusBadge(t.status)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch (e) {}
}

/* ── History ─────────────────────────────────────────────────────── */
async function renderHistory() {
  try {
    const d = await api('GET', '/api/student/history');
    const tbody = $('history-tbody');
    if (!d.transactions.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--color-text-muted); padding:24px;">No transactions found.</td></tr>';
      return;
    }
    tbody.innerHTML = d.transactions.map(t => `<tr>
      <td>${t.date || '—'}</td>
      <td style="font-weight:700;">${t.reference_number}</td>
      <td>${statusBadge(t.type === 'Department Consultation' ? t.type : 'Service Request')}</td>
      <td>${t.entity_name}</td>
      <td>${t.concern}</td>
      <td>${statusBadge(t.status)}</td>
      <td>${t.waiting_duration || '—'}</td>
    </tr>`).join('');
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   DEPARTMENT APPOINTMENT FLOW
   ═══════════════════════════════════════════════════════════════════ */
let deptFlowState = { step: 1, department: null, concern: null, professor: null, date: null, time: null };
let deptData = { departments: [], professors: [], concerns: [] };

const DEPT_STEPS = ['Department', 'Concern', 'Professor', 'Schedule', 'Confirm', 'QR'];

function renderDeptStepper(current) {
  const el = $('dept-stepper');
  if (!el) return;
  el.innerHTML = DEPT_STEPS.map((s, i) => {
    const n = i + 1;
    let cls = n < current ? 'done' : n === current ? 'active' : '';
    return `${i > 0 ? '<span class="step-sep">›</span>' : ''}<span class="step-item ${cls}"><span class="step-num">${n < current ? '✓' : n}</span>${s}</span>`;
  }).join('');
}

async function resetDeptFlow() {
  deptFlowState = { step: 1, department: null, concern: null, professor: null, date: null, time: null };
  if (!currentUser) { goTo('student-login'); return; }

  try {
    const d = await api('GET', '/api/student/departments');
    deptData = d;
  } catch (e) { toast('Error', 'Failed to load department data.'); return; }

  // Show only step 1
  [1,2,3,4,5,6].forEach(n => {
    const el = $(`dept-step-${n}`);
    if (el) el.classList.toggle('hidden', n !== 1);
  });

  renderDeptStepper(1);
  renderDeptGrid();
}

function renderDeptGrid() {
  const grid = $('dept-grid');
  if (!grid) return;
  grid.innerHTML = deptData.departments.map(dept => `
    <div class="dept-choice-row" data-dept="${dept.id}" style="
      display:flex; justify-content:space-between; align-items:center;
      border:1px solid var(--color-border); border-radius:var(--radius-sm);
      padding:14px 18px; cursor:${dept.active ? 'pointer' : 'not-allowed'};
      background:${dept.active ? 'white' : '#f7f7f7'};
      opacity:${dept.active ? '1' : '0.55'};
      transition: border-color 0.15s;
    " ${dept.active ? '' : 'aria-disabled="true"'}>
      <div>
        <div style="font-size:14px; font-weight:700; color:var(--color-black);">${dept.name}</div>
        <div style="font-size:12px; color:var(--color-text-muted); margin-top:2px;">${dept.code}</div>
      </div>
      <div>${dept.active
        ? '<span class="badge badge-green">Available</span>'
        : '<span class="badge badge-gray">Coming Soon</span>'
      }</div>
    </div>
  `).join('');

  grid.querySelectorAll('.dept-choice-row').forEach(row => {
    row.addEventListener('mouseenter', () => { if (!row.getAttribute('aria-disabled')) row.style.borderColor = 'var(--color-primary)'; });
    row.addEventListener('mouseleave', () => { if (!row.getAttribute('aria-disabled')) row.style.borderColor = 'var(--color-border)'; });
    row.addEventListener('click', () => {
      const deptId = row.dataset.dept;
      const dept = deptData.departments.find(d => d.id === deptId);
      if (!dept || !dept.active) { toast('Unavailable', 'This department is not available yet in the demo.'); return; }
      deptFlowState.department = dept;
      goToDeptStep(2);
    });
  });
}

function renderConcernList() {
  const el = $('dept-step2-name');
  if (el) el.textContent = deptFlowState.department ? deptFlowState.department.name : '';
  const list = $('concern-list');
  if (!list) return;
  list.innerHTML = deptData.concerns.map(c => `
    <div class="concern-row" data-concern="${c}" style="
      border:1px solid var(--color-border); border-radius:var(--radius-sm);
      padding:12px 16px; cursor:pointer; font-size:14px; font-weight:600;
      display:flex; justify-content:space-between; align-items:center;
      transition: border-color 0.15s;
    ">
      <span>${c}</span><span style="color:var(--color-text-muted);">›</span>
    </div>
  `).join('');
  list.querySelectorAll('.concern-row').forEach(row => {
    row.addEventListener('mouseenter', () => row.style.borderColor = 'var(--color-primary)');
    row.addEventListener('mouseleave', () => row.style.borderColor = 'var(--color-border)');
    row.addEventListener('click', () => { deptFlowState.concern = row.dataset.concern; goToDeptStep(3); });
  });
}

function renderProfessorList() {
  const list = $('professor-list');
  if (!list) return;
  list.innerHTML = deptData.professors.map(p => `
    <div class="prof-row" data-prof="${p.name}" style="
      border:1px solid var(--color-border); border-radius:var(--radius-sm);
      padding:12px 16px; cursor:pointer; font-size:14px; font-weight:600;
      display:flex; justify-content:space-between; align-items:center;
      transition: border-color 0.15s;
    ">
      <span>${p.name}</span><span style="color:var(--color-text-muted);">›</span>
    </div>
  `).join('');
  list.querySelectorAll('.prof-row').forEach(row => {
    row.addEventListener('mouseenter', () => row.style.borderColor = 'var(--color-primary)');
    row.addEventListener('mouseleave', () => row.style.borderColor = 'var(--color-border)');
    row.addEventListener('click', () => { deptFlowState.professor = row.dataset.prof; goToDeptStep(4); });
  });
}

function renderDateTimeStep() {
  const dateInput = $('appt-date');
  const today = new Date();
  const minDate = today.toISOString().split('T')[0];
  const maxDate = new Date(today.setDate(today.getDate() + 30)).toISOString().split('T')[0];
  if (dateInput) { dateInput.min = minDate; dateInput.max = maxDate; dateInput.value = deptFlowState.date || ''; }
  if (dateInput && !dateInput._bound) {
    dateInput._bound = true;
    dateInput.addEventListener('change', () => { deptFlowState.date = dateInput.value; renderTimeSlots(); });
  }
  renderTimeSlots();

  const toConfirmBtn = $('dept-to-confirm');
  if (toConfirmBtn && !toConfirmBtn._bound) {
    toConfirmBtn._bound = true;
    toConfirmBtn.addEventListener('click', () => {
      if (!deptFlowState.date) { toast('Missing', 'Please select a date.'); return; }
      if (!deptFlowState.time) { toast('Missing', 'Please select a time slot.'); return; }
      goToDeptStep(5);
    });
  }
}

const TIME_SLOTS = ['08:00 AM','08:30 AM','09:00 AM','09:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM','01:00 PM','01:30 PM','02:00 PM','02:30 PM','03:00 PM','03:30 PM','04:00 PM'];
const TAKEN_SLOTS = { '2026-09-08': ['10:30 AM','11:00 AM'], '2026-09-09': ['08:00 AM','09:00 AM','01:00 PM'] };

function renderTimeSlots() {
  const container = $('time-slots-container');
  if (!container) return;
  const date = deptFlowState.date;
  const taken = TAKEN_SLOTS[date] || [];
  container.innerHTML = TIME_SLOTS.map(t => {
    const isT = taken.includes(t);
    const isSel = deptFlowState.time === t;
    return `<button class="slot-btn ${isT ? 'disabled' : ''} ${isSel ? 'selected' : ''}" data-time="${t}" ${isT ? 'disabled' : ''}>${t}</button>`;
  }).join('');
  container.querySelectorAll('.slot-btn:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      deptFlowState.time = btn.dataset.time;
      container.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
}

function renderApptSummary() {
  const box = $('appt-summary');
  if (!box || !deptFlowState.department) return;
  box.innerHTML = `
    <div style="display:grid; grid-template-columns:auto 1fr; gap:8px 16px; font-size:13px;">
      <span style="font-weight:700; color:var(--color-text-secondary);">Department</span><span>${deptFlowState.department.name}</span>
      <span style="font-weight:700; color:var(--color-text-secondary);">Concern</span><span>${deptFlowState.concern}</span>
      <span style="font-weight:700; color:var(--color-text-secondary);">Professor</span><span>${deptFlowState.professor || 'None'}</span>
      <span style="font-weight:700; color:var(--color-text-secondary);">Date</span><span>${deptFlowState.date}</span>
      <span style="font-weight:700; color:var(--color-text-secondary);">Time</span><span>${deptFlowState.time}</span>
      <span style="font-weight:700; color:var(--color-text-secondary);">Student</span><span>${currentUser ? currentUser.full_name : '—'}</span>
    </div>
  `;
  const errEl = $('appt-confirm-error');
  clearErr(errEl);
  const btn = $('confirm-appt-btn');
  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', submitAppointment);
  }
}

async function submitAppointment() {
  const errEl = $('appt-confirm-error');
  clearErr(errEl);
  const btn = $('confirm-appt-btn');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const d = await api('POST', '/api/student/book-appointment', {
      department_id: deptFlowState.department.id,
      concern: deptFlowState.concern,
      professor: deptFlowState.professor,
      date: deptFlowState.date,
      time: deptFlowState.time
    });
    showApptQR(d.appointment);
    goToDeptStep(6, false);
  } catch (e) {
    err(errEl, e.message);
  } finally { btn.disabled = false; btn.textContent = 'Submit Appointment'; }
}

function showApptQR(appt) {
  const numEl = $('appt-success-num');
  const detEl = $('appt-success-details');
  const lblEl = $('appt-qr-label');
  if (numEl) numEl.textContent = appt.appointment_number;
  if (detEl) detEl.textContent = `${appt.date} at ${appt.time} — ${appt.department_name}`;
  if (lblEl) lblEl.textContent = appt.qr_token;
  setTimeout(() => generateQR('appt-qr-canvas', appt.qr_token, 150), 300);

  const dlBtn = $('download-appt-qr');
  if (dlBtn && !dlBtn._bound) {
    dlBtn._bound = true;
    dlBtn.addEventListener('click', () => downloadQR('appt-qr-canvas', `appt-${appt.appointment_number}.png`));
  }
}

function goToDeptStep(n, scroll = true) {
  [1,2,3,4,5,6].forEach(i => {
    const el = $(`dept-step-${i}`);
    if (el) el.classList.toggle('hidden', i !== n);
  });
  deptFlowState.step = n;
  renderDeptStepper(n);
  if (n === 2) renderConcernList();
  if (n === 3) renderProfessorList();
  if (n === 4) renderDateTimeStep();
  if (n === 5) renderApptSummary();
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ═══════════════════════════════════════════════════════════════════
   SERVICE / QUEUE FLOW
   ═══════════════════════════════════════════════════════════════════ */
let svcFlowState = { step: 1, office: null, concern: null };
let svcData = { offices: [], concerns: {} };

const SVC_STEPS = ['Select Service', 'Concern', 'Confirm', 'Ticket'];

function renderSvcStepper(current) {
  const el = $('service-stepper');
  if (!el) return;
  el.innerHTML = SVC_STEPS.map((s, i) => {
    const n = i + 1;
    let cls = n < current ? 'done' : n === current ? 'active' : '';
    return `${i > 0 ? '<span class="step-sep">›</span>' : ''}<span class="step-item ${cls}"><span class="step-num">${n < current ? '✓' : n}</span>${s}</span>`;
  }).join('');
}

async function resetServiceFlow() {
  svcFlowState = { step: 1, office: null, concern: null };
  if (!currentUser) { goTo('student-login'); return; }
  try {
    const d = await api('GET', '/api/student/services');
    svcData = d;
  } catch (e) { toast('Error', 'Failed to load services.'); return; }

  [1,2,3,4].forEach(n => {
    const el = $(`svc-step-${n}`);
    if (el) el.classList.toggle('hidden', n !== 1);
  });
  renderSvcStepper(1);
  renderServiceOfficeGrid();
}

function renderServiceOfficeGrid() {
  const grid = $('service-office-grid');
  if (!grid) return;
  grid.innerHTML = (svcData.offices || []).map(o => `
    <div class="svc-office-row" data-id="${o.id}" style="
      display:flex; justify-content:space-between; align-items:center;
      border:1px solid var(--color-border); border-radius:var(--radius-sm);
      padding:14px 18px; cursor:pointer; font-size:14px; font-weight:600;
      transition:border-color 0.15s;
    ">
      <span>${o.name}</span><span style="color:var(--color-text-muted);">›</span>
    </div>
  `).join('');
  grid.querySelectorAll('.svc-office-row').forEach(row => {
    row.addEventListener('mouseenter', () => row.style.borderColor = 'var(--color-primary)');
    row.addEventListener('mouseleave', () => row.style.borderColor = 'var(--color-border)');
    row.addEventListener('click', () => {
      const office = svcData.offices.find(o => o.id === row.dataset.id);
      if (!office) return;
      svcFlowState.office = office;
      goToSvcStep(2);
    });
  });
}

function renderSvcConcernList() {
  const nameEl = $('svc-step2-name');
  if (nameEl) nameEl.textContent = svcFlowState.office ? svcFlowState.office.name : '';
  const list = $('svc-concern-list');
  if (!list) return;
  const concerns = (svcData.concerns || {})[svcFlowState.office.id] || ['General Inquiry'];
  list.innerHTML = concerns.map(c => `
    <div class="svc-concern-row" data-concern="${c}" style="
      border:1px solid var(--color-border); border-radius:var(--radius-sm);
      padding:12px 16px; cursor:pointer; font-size:14px; font-weight:600;
      display:flex; justify-content:space-between; align-items:center;
      transition:border-color 0.15s;
    ">
      <span>${c}</span><span style="color:var(--color-text-muted);">›</span>
    </div>
  `).join('');
  list.querySelectorAll('.svc-concern-row').forEach(row => {
    row.addEventListener('mouseenter', () => row.style.borderColor = 'var(--color-primary)');
    row.addEventListener('mouseleave', () => row.style.borderColor = 'var(--color-border)');
    row.addEventListener('click', () => { svcFlowState.concern = row.dataset.concern; goToSvcStep(3); });
  });
}

function renderSvcSummary() {
  const box = $('svc-summary');
  if (!box) return;
  box.innerHTML = `
    <div style="display:grid; grid-template-columns:auto 1fr; gap:8px 16px; font-size:13px;">
      <span style="font-weight:700; color:var(--color-text-secondary);">Office</span><span>${svcFlowState.office ? svcFlowState.office.name : '—'}</span>
      <span style="font-weight:700; color:var(--color-text-secondary);">Concern</span><span>${svcFlowState.concern || '—'}</span>
      <span style="font-weight:700; color:var(--color-text-secondary);">Student</span><span>${currentUser ? currentUser.full_name : '—'}</span>
    </div>
  `;
  clearErr($('svc-confirm-error'));
  const btn = $('confirm-queue-btn');
  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', submitQueueRequest);
  }
}

async function submitQueueRequest() {
  const errEl = $('svc-confirm-error');
  clearErr(errEl);
  const btn = $('confirm-queue-btn');
  btn.disabled = true; btn.textContent = 'Joining queue…';
  try {
    const d = await api('POST', '/api/student/join-queue', {
      service_office_id: svcFlowState.office.id,
      concern: svcFlowState.concern
    });
    showQueueTicket(d.ticket);
    goToSvcStep(4, false);
  } catch (e) {
    err(errEl, e.message);
  } finally { btn.disabled = false; btn.textContent = 'Get Queue Ticket'; }
}

function showQueueTicket(ticket) {
  const ofcEl = $('ticket-office-label');
  const numEl = $('ticket-number-display');
  const cnEl = $('ticket-concern-display');
  const waitEl = $('ticket-wait-display');
  const servingEl = $('ticket-serving-display');
  const lblEl = $('svc-qr-label');

  if (ofcEl) ofcEl.textContent = ticket.service_office_name;
  if (numEl) numEl.textContent = ticket.ticket_number;
  if (cnEl) cnEl.textContent = ticket.concern;
  if (waitEl) waitEl.textContent = ticket.estimated_wait_min ? `~${ticket.estimated_wait_min} minutes` : 'Unknown';
  if (servingEl) servingEl.textContent = ticket.now_serving || '—';
  if (lblEl) lblEl.textContent = ticket.qr_token;
  setTimeout(() => generateQR('svc-qr-canvas', ticket.qr_token, 150), 300);

  const dlBtn = $('download-queue-qr');
  if (dlBtn && !dlBtn._bound) {
    dlBtn._bound = true;
    dlBtn.addEventListener('click', () => downloadQR('svc-qr-canvas', `ticket-${ticket.ticket_number}.png`));
  }
}

function goToSvcStep(n, scroll = true) {
  [1,2,3,4].forEach(i => {
    const el = $(`svc-step-${i}`);
    if (el) el.classList.toggle('hidden', i !== n);
  });
  svcFlowState.step = n;
  renderSvcStepper(n);
  if (n === 2) renderSvcConcernList();
  if (n === 3) renderSvcSummary();
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ═══════════════════════════════════════════════════════════════════
   DEPT LOGIN
   ═══════════════════════════════════════════════════════════════════ */
function renderDeptLogin() {
  const btn = document.querySelector('.portal-tab-btn[data-portal="department"]');
  if (btn) btn.click();
  goTo('student-login');
}

/* ═══════════════════════════════════════════════════════════════════
   SERVICES LOGIN
   ═══════════════════════════════════════════════════════════════════ */
function renderServicesLogin() {
  const btn = document.querySelector('.portal-tab-btn[data-portal="service"]');
  if (btn) btn.click();
  goTo('student-login');
}

/* ═══════════════════════════════════════════════════════════════════
   DEPT SECRETARY DASHBOARD
   ═══════════════════════════════════════════════════════════════════ */
async function renderDeptDashboard() {
  if (!currentUser || (currentUser.role !== 'department' && currentUser.role !== 'dept_secretary')) return;
  const nameEl = $('dept-portal-name');
  if (nameEl) nameEl.textContent = currentUser.department_name || 'Department';

  try {
    const d = await api('GET', '/api/staff/dept-appointments');
    renderDeptStats(d.stats);
    renderDeptTable(d.appointments, 'dept-appt-tbody', true);
    renderDeptTable(d.appointments, 'dept-all-tbody', false);
  } catch (e) { toast('Error', 'Failed to load appointments.'); }
}

function renderDeptStats(stats) {
  const grid = $('dept-stats-grid');
  if (!grid || !stats) return;
  grid.innerHTML = [
    ['Total', stats.total || 0],
    ['Scheduled', stats.scheduled || 0],
    ['Checked In', stats.checkedIn || 0],
    ['Completed', stats.completed || 0]
  ].map(([l, v]) => `<div class="stat-box"><div class="stat-label">${l}</div><div class="stat-num">${v}</div></div>`).join('');
}

function renderDeptTable(appointments, tbodyId, showActions) {
  const tbody = $(tbodyId);
  if (!tbody) return;
  if (!appointments.length) {
    const cols = showActions ? 7 : 5;
    tbody.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;padding:24px;color:var(--color-text-muted);">No appointments found.</td></tr>`;
    return;
  }
  tbody.innerHTML = appointments.map(a => {
    if (showActions) {
      return `<tr>
        <td style="font-weight:700;">${a.appointment_number}</td>
        <td>${a.student_name}<br><span style="font-size:11px;color:var(--color-text-muted);">${a.student_number}</span></td>
        <td>${a.concern}</td>
        <td>${a.professor || '—'}</td>
        <td>${a.time}</td>
        <td>${statusBadge(a.status)}</td>
        <td>${renderDeptActions(a)}</td>
      </tr>`;
    } else {
      return `<tr>
        <td style="font-weight:700;">${a.appointment_number}</td>
        <td>${a.date || '—'}</td>
        <td>${a.student_name}</td>
        <td>${a.concern}</td>
        <td>${statusBadge(a.status)}</td>
      </tr>`;
    }
  }).join('');

  tbody.querySelectorAll('.dept-action-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { apptId, action } = btn.dataset;
      btn.disabled = true; btn.textContent = '…';
      try {
        const d = await api('POST', '/api/staff/dept-action', { appointment_id: apptId, action });
        toast('Done', d.message);
        renderDeptDashboard();
      } catch (e) { toast('Error', e.message); btn.disabled = false; }
    });
  });
}

function renderDeptActions(a) {
  if (a.status === 'Scheduled') return `<button class="btn btn-sm btn-primary dept-action-btn" data-appt-id="${a.id}" data-action="Notify">Notify Student</button>`;
  if (a.status === 'Called' || a.status === 'Checked In') return `<button class="btn btn-sm btn-black dept-action-btn" data-appt-id="${a.id}" data-action="Start">Start Consultation</button>`;
  if (a.status === 'In Consultation') return `<button class="btn btn-sm btn-outline dept-action-btn" data-appt-id="${a.id}" data-action="Done">Mark Done</button>`;
  return `<span style="font-size:12px;color:var(--color-text-muted);">${a.status}</span>`;
}

/* ═══════════════════════════════════════════════════════════════════
   SERVICES STAFF DASHBOARD
   ═══════════════════════════════════════════════════════════════════ */
async function renderServicesDashboard() {
  if (!currentUser || (currentUser.role !== 'service' && currentUser.role !== 'services_staff')) return;
  const nameEl = $('services-portal-name');
  if (nameEl) nameEl.textContent = currentUser.service_office_name || 'Service Office';

  try {
    const officeId = currentUser.service_office_id;
    const d = await api('GET', `/api/staff/services-requests?office_id=${officeId}`);
    renderSvcStats(d.stats);
    renderSvcQueueView(d.requests);
    renderCtrlView(d.stats, d.requests);
  } catch (e) { toast('Error', 'Failed to load queue data.'); }
}

function renderSvcStats(stats) {
  const grid = $('svc-stats-grid');
  if (!grid || !stats) return;
  grid.innerHTML = [
    ['Waiting', stats.waiting || 0],
    ['In Service', stats.inService || 0],
    ['Completed Today', stats.completedToday || 0],
    ['Total', (stats.waiting || 0) + (stats.inService || 0) + (stats.completedToday || 0)]
  ].map(([l, v]) => `<div class="stat-box"><div class="stat-label">${l}</div><div class="stat-num">${v}</div></div>`).join('');
}

function renderSvcQueueView(requests) {
  const nowServing = requests.find(q => q.status === 'Called' || q.status === 'In Service');
  const waiting = requests.filter(q => q.status === 'Waiting');
  const next = waiting[0];

  const nowBox = $('svc-now-serving-box');
  if (nowBox) {
    if (nowServing) {
      nowBox.innerHTML = `
        <div style="font-size:30px;font-weight:900;color:var(--color-primary);margin-bottom:6px;">${nowServing.ticket_number}</div>
        <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${nowServing.student_name}</div>
        <div style="font-size:12px;color:var(--color-text-muted);">${nowServing.concern}</div>
        <div style="margin-top:12px;">
          ${nowServing.status === 'Called' ? `<button class="btn btn-sm btn-black svc-action-btn" data-ticket-id="${nowServing.id}" data-action="Start">Start Service</button>` : ''}
          <button class="btn btn-sm btn-outline svc-action-btn" data-ticket-id="${nowServing.id}" data-action="Done" style="margin-left:6px;">Mark Done</button>
        </div>
      `;
    } else {
      nowBox.innerHTML = '<div style="font-size:13px;color:var(--color-text-muted);">No active ticket</div>';
    }
  }

  const nextBox = $('svc-next-box');
  if (nextBox) {
    if (next) {
      nextBox.innerHTML = `
        <div style="font-size:24px;font-weight:900;color:var(--color-black);margin-bottom:4px;">${next.ticket_number}</div>
        <div style="font-size:13px;font-weight:600;">${next.student_name}</div>
        <div style="font-size:12px;color:var(--color-text-muted);">${next.concern}</div>
        <div style="margin-top:12px;">
          <button class="btn btn-sm btn-primary svc-action-btn" data-ticket-id="${next.id}" data-action="Notify">Call / Notify</button>
        </div>
      `;
    } else {
      nextBox.innerHTML = '<div style="font-size:13px;color:var(--color-text-muted);">Queue is empty</div>';
    }
  }

  // Waiting list
  const tbody = $('svc-queue-tbody');
  if (tbody) {
    if (!waiting.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--color-text-muted);">No one waiting.</td></tr>';
    } else {
      tbody.innerHTML = waiting.map((q, i) => `<tr>
        <td style="font-weight:700;">${q.ticket_number}</td>
        <td>${q.student_name}</td>
        <td>${q.concern}</td>
        <td>#${i + 1}</td>
        <td>${statusBadge(q.status)}</td>
        <td><button class="btn btn-sm btn-primary svc-action-btn" data-ticket-id="${q.id}" data-action="Notify">Call</button></td>
      </tr>`).join('');
    }
  }

  // All requests table
  const allTbody = $('svc-all-tbody');
  if (allTbody) {
    if (!requests.length) {
      allTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--color-text-muted);">No requests.</td></tr>';
    } else {
      allTbody.innerHTML = requests.map(q => `<tr>
        <td style="font-weight:700;">${q.ticket_number}</td>
        <td>${q.student_name}</td>
        <td>${q.concern}</td>
        <td>${statusBadge(q.status)}</td>
        <td>${q.counter || '—'}</td>
        <td>${renderSvcActions(q)}</td>
      </tr>`).join('');
    }
  }

  // Bind action buttons
  document.querySelectorAll('.svc-action-btn').forEach(btn => {
    if (btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', async () => {
      const { ticketId, action } = btn.dataset;
      const counter = $('ctrl-counter-select') ? $('ctrl-counter-select').value : 'Counter 1';
      btn.disabled = true;
      try {
        const d = await api('POST', '/api/staff/services-action', { ticket_id: ticketId, action, counter });
        toast('Done', d.message);
        renderServicesDashboard();
      } catch (e) { toast('Error', e.message); btn.disabled = false; }
    });
  });
}

function renderSvcActions(q) {
  if (q.status === 'Waiting') return `<button class="btn btn-sm btn-primary svc-action-btn" data-ticket-id="${q.id}" data-action="Notify">Call</button>`;
  if (q.status === 'Called') return `<button class="btn btn-sm btn-black svc-action-btn" data-ticket-id="${q.id}" data-action="Start">Start</button>`;
  if (q.status === 'In Service') return `<button class="btn btn-sm btn-outline svc-action-btn" data-ticket-id="${q.id}" data-action="Done">Done</button>`;
  return `<span style="font-size:12px;color:var(--color-text-muted);">${q.status}</span>`;
}

function renderCtrlView(stats, requests) {
  const nowEl = $('ctrl-now-serving');
  const waitEl = $('ctrl-waiting');
  const doneEl = $('ctrl-completed');
  const nowServing = requests.find(q => q.status === 'Called' || q.status === 'In Service');
  if (nowEl) nowEl.textContent = nowServing ? nowServing.ticket_number : '—';
  if (waitEl) waitEl.textContent = stats ? stats.waiting : 0;
  if (doneEl) doneEl.textContent = stats ? stats.completedToday : 0;
}

/* ═══════════════════════════════════════════════════════════════════
   TV DISPLAY
   ═══════════════════════════════════════════════════════════════════ */
let tvOfficeId = null;
let tvTimer = null;

async function renderTVSelect() {
  try {
    const d = await api('GET', '/api/student/services');
    const sel = $('tv-office-select');
    if (!sel) return;
    sel.innerHTML = (d.offices || []).map(o => `<option value="${o.id}">${o.name}</option>`).join('');
  } catch (e) {}

  const btn = $('tv-launch-btn');
  if (!btn || btn._bound) return;
  btn._bound = true;
  btn.addEventListener('click', () => {
    const sel = $('tv-office-select');
    tvOfficeId = sel ? sel.value : 'office-treasury';
    goTo('tv-display');
  });
}

async function startTVDisplay() {
  if (!tvOfficeId) tvOfficeId = 'office-treasury';
  updateTVClock();
  tvTimer = setInterval(updateTVClock, 1000);
  await refreshTVData();
  setInterval(refreshTVData, 5000);
}

function updateTVClock() {
  const el = $('tv-clock');
  if (el) el.textContent = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function refreshTVData() {
  try {
    const d = await api('GET', `/api/staff/queue-controller?office_id=${tvOfficeId}`);
    const nameEl = $('tv-office-name');
    if (nameEl) nameEl.textContent = d.officeName;
    const servingEl = $('tv-now-serving');
    const counterEl = $('tv-counter-label');
    if (servingEl) servingEl.textContent = d.nowServing ? d.nowServing.ticket_number : '—';
    if (counterEl) counterEl.textContent = d.nowServing ? `Please proceed to ${d.nowServing.counter || 'the counter'}` : 'Please wait for your number to be called';
    const waitingEl = $('tv-waiting-count');
    if (waitingEl) waitingEl.textContent = d.waitingList ? d.waitingList.length : 0;
    const nextEl = $('tv-next-ticket');
    if (nextEl) nextEl.textContent = d.waitingList && d.waitingList[0] ? d.waitingList[0].ticket_number : '—';
    const listEl = $('tv-queue-list');
    if (listEl && d.waitingList) {
      listEl.innerHTML = d.waitingList.slice(0, 6).map(q => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#1a1a1a; border-radius:4px; padding:8px 12px;">
          <span style="font-weight:700; color:#fff; font-size:16px;">${q.ticket_number}</span>
          <span style="font-size:11px; color:#666;">${q.concern}</span>
        </div>
      `).join('');
    }
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   SOCKET.IO
   ═══════════════════════════════════════════════════════════════════ */
function initSocket() {
  if (socket) return;
  try {
    socket = io();
    socket.on('student_notification', data => {
      if (!currentUser) return;
      if (data.user_id === currentUser.id || data.user_id === currentUser.id)
        toast(data.title || 'Notification', data.message || '');
    });
    socket.on('queue_updated', () => {
      if (currentView === 'tv-display') refreshTVData();
      if (currentView === 'services-dashboard') renderServicesDashboard();
    });
    socket.on('dept_appointment_updated', () => {
      if (currentView === 'dept-dashboard') renderDeptDashboard();
    });
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   QUEUE CONTROLLER BINDINGS
   ═══════════════════════════════════════════════════════════════════ */
function bindCtrlButtons() {
  const callNext = $('ctrl-call-next');
  const recall = $('ctrl-recall');
  const skip = $('ctrl-skip');
  if (!callNext || callNext._bound) return;
  callNext._bound = true;

  [callNext, recall, skip].forEach(btn => {
    if (!btn) return;
    btn._bound = true;
    btn.addEventListener('click', async () => {
      const action = btn.textContent.trim();
      const counter = $('ctrl-counter-select') ? $('ctrl-counter-select').value : 'Counter 1';
      const officeId = currentUser ? currentUser.service_office_id : 'office-treasury';
      btn.disabled = true;
      try {
        const d = await api('POST', '/api/staff/queue-controller-action', { office_id: officeId, action, counter });
        toast('Queue Controller', d.message || 'Done.');
        renderServicesDashboard();
      } catch (e) { toast('Error', e.message); }
      finally { btn.disabled = false; }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   GLOBAL EVENT DELEGATION
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-view]');
  if (el) { e.preventDefault(); goTo(el.dataset.view); }
});

/* Tab switching */
document.addEventListener('click', e => {
  const tab = e.target.closest('.staff-tab');
  if (!tab) return;
  const tabGroup = tab.closest('.staff-tabs');
  if (!tabGroup) return;
  tabGroup.querySelectorAll('.staff-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  const tabId = tab.dataset.tab;
  const panel = tab.closest('.main-container');
  if (!panel) return;
  ['dept-tab-today','dept-tab-all','svc-tab-queue','svc-tab-requests','svc-tab-controller'].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle('hidden', id !== tabId);
  });
  if (tabId === 'svc-tab-controller') bindCtrlButtons();
});

/* Logout buttons */
document.addEventListener('click', e => {
  if (e.target.id === 'logout-btn' || e.target.id === 'dept-logout-btn' || e.target.id === 'svc-logout-btn') logout();
});

/* Refresh buttons */
document.addEventListener('click', e => {
  if (e.target.id === 'dept-refresh-btn') renderDeptDashboard();
  if (e.target.id === 'svc-refresh-btn') renderServicesDashboard();
});

/* Dept flow back buttons */
document.addEventListener('click', e => {
  if (e.target.id === 'dept-back-step1') goToDeptStep(1);
  if (e.target.id === 'dept-back-step2') goToDeptStep(2);
  if (e.target.id === 'dept-back-step3') goToDeptStep(3);
  if (e.target.id === 'dept-back-step4') goToDeptStep(4);
});

/* Service flow back buttons */
document.addEventListener('click', e => {
  if (e.target.id === 'svc-back-step1') goToSvcStep(1);
  if (e.target.id === 'svc-back-step2') goToSvcStep(2);
});

/* Dashboard panel clicks */
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-view]');
  if (!btn) return;
  const view = btn.dataset.view;
  if (!view) return;
  if ((view === 'dept-flow' || view === 'service-flow') && !currentUser) {
    e.preventDefault();
    goTo('student-login');
  }
});

/* ═══════════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  setupPortalLogin();
  setupPortalRegister();
  checkSession();

  window.addEventListener('hashchange', () => {
    const h = window.location.hash.replace('#', '');
    if (h && VIEWS.includes(h) && h !== currentView) {
      goTo(h);
    }
  });
});
