-- ═══════════════════════════════════════════════════════════════════
-- Q-Less: Digital Queueing for Mapúa Services
-- Complete Supabase PostgreSQL Schema & Row Level Security (RLS) Setup
-- ═══════════════════════════════════════════════════════════════════

-- 1. Custom User Profiles Table (Linked with Supabase auth.users UUIDs)
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  student_number TEXT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'student',
  created_at TEXT NOT NULL DEFAULT timezone('utc'::text, now())::text
);

-- 2. Role Specific Details Tables
CREATE TABLE IF NOT EXISTS public.students (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  school TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.departmental_staff (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  department TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.service_staff (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  service_office TEXT NOT NULL
);

-- 3. Academic Departments & Professors
CREATE TABLE IF NOT EXISTS public.departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.professors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department_id TEXT
);

CREATE TABLE IF NOT EXISTS public.dept_concerns (
  id SERIAL PRIMARY KEY,
  concern TEXT NOT NULL
);

-- 4. Service Offices & Concerns
CREATE TABLE IF NOT EXISTS public.service_offices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.service_concerns (
  id SERIAL PRIMARY KEY,
  office_id TEXT NOT NULL,
  concern TEXT NOT NULL
);

-- 5. Appointments & Queue Tickets
CREATE TABLE IF NOT EXISTS public.appointments (
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
);

CREATE TABLE IF NOT EXISTS public.queue_tickets (
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
);

CREATE TABLE IF NOT EXISTS public.transactions (
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
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departmental_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_offices ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running script
DROP POLICY IF EXISTS "Allow select users" ON public.users;
DROP POLICY IF EXISTS "Allow insert users" ON public.users;
DROP POLICY IF EXISTS "Allow update users" ON public.users;
DROP POLICY IF EXISTS "Allow select students" ON public.students;
DROP POLICY IF EXISTS "Allow insert students" ON public.students;
DROP POLICY IF EXISTS "Allow select departmental_staff" ON public.departmental_staff;
DROP POLICY IF EXISTS "Allow insert departmental_staff" ON public.departmental_staff;
DROP POLICY IF EXISTS "Allow select service_staff" ON public.service_staff;
DROP POLICY IF EXISTS "Allow insert service_staff" ON public.service_staff;
DROP POLICY IF EXISTS "Allow select appointments" ON public.appointments;
DROP POLICY IF EXISTS "Allow insert appointments" ON public.appointments;
DROP POLICY IF EXISTS "Allow update appointments" ON public.appointments;
DROP POLICY IF EXISTS "Allow select queue_tickets" ON public.queue_tickets;
DROP POLICY IF EXISTS "Allow insert queue_tickets" ON public.queue_tickets;
DROP POLICY IF EXISTS "Allow update queue_tickets" ON public.queue_tickets;
DROP POLICY IF EXISTS "Allow select departments" ON public.departments;
DROP POLICY IF EXISTS "Allow select service_offices" ON public.service_offices;

-- Create Permissive & Clean RLS Policies
CREATE POLICY "Allow select users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Allow insert users" ON public.users FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update users" ON public.users FOR UPDATE USING (true);

CREATE POLICY "Allow select students" ON public.students FOR SELECT USING (true);
CREATE POLICY "Allow insert students" ON public.students FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select departmental_staff" ON public.departmental_staff FOR SELECT USING (true);
CREATE POLICY "Allow insert departmental_staff" ON public.departmental_staff FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select service_staff" ON public.service_staff FOR SELECT USING (true);
CREATE POLICY "Allow insert service_staff" ON public.service_staff FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow select appointments" ON public.appointments FOR SELECT USING (true);
CREATE POLICY "Allow insert appointments" ON public.appointments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update appointments" ON public.appointments FOR UPDATE USING (true);

CREATE POLICY "Allow select queue_tickets" ON public.queue_tickets FOR SELECT USING (true);
CREATE POLICY "Allow insert queue_tickets" ON public.queue_tickets FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update queue_tickets" ON public.queue_tickets FOR UPDATE USING (true);

CREATE POLICY "Allow select departments" ON public.departments FOR SELECT USING (true);
CREATE POLICY "Allow select service_offices" ON public.service_offices FOR SELECT USING (true);
