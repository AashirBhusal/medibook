// MediBook prototype server - ITS205 Term Project (Assessment B)
// Implements: FR-01 registration, FR-03 availability search, FR-04 slot locking,
// FR-05 double-booking rejection, FR-07/08 cancellation and slot release,
// FR-12 my appointments, FR-13 reception booking, FR-14 audit log,
// FR-15 attendance statuses, FR-20 (partial) role separation.
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const { hashPassword, verifyPassword } = require('./auth');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'medibook-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 60 * 1000 }, // 30-minute idle expiry per NFR-01
}));

function pad(n) { return String(n).padStart(2, '0'); }
function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function todayStr() { return nowStr().slice(0, 10); }
function hoursUntil(startTime) {
  const [d, t] = startTime.split(' ');
  const start = new Date(`${d}T${t}:00`);
  return (start - new Date()) / 36e5;
}
function fmt(startTime) {
  const [d, t] = startTime.split(' ');
  const day = new Date(`${d}T${t}:00`);
  return day.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ' at ' + t;
}
app.locals.fmt = fmt;

function requirePatient(req, res, next) {
  if (req.session.patientId) return next();
  res.redirect('/login');
}
function requireStaff(req, res, next) {
  if (req.session.staffId) return next();
  res.redirect('/staff');
}
function audit(userType, userId, action, recordRef) {
  db.prepare('INSERT INTO audit_log (user_type, user_id, action, record_ref) VALUES (?, ?, ?, ?)')
    .run(userType, userId, action, recordRef);
}
function ctx(req, extra) {
  return Object.assign({
    patient: req.session.patientId
      ? db.prepare('SELECT * FROM patients WHERE id = ?').get(req.session.patientId) : null,
    staff: req.session.staffId
      ? db.prepare('SELECT * FROM staff WHERE id = ?').get(req.session.staffId) : null,
  }, extra);
}

// ---------- Home ----------
app.get('/', (req, res) => {
  if (req.session.patientId) return res.redirect('/search');
  if (req.session.staffId) return res.redirect('/reception');
  res.redirect('/login');
});

// ---------- FR-01: patient registration ----------
app.get('/register', (req, res) => res.render('register', ctx(req, { errors: [], form: {} })));

app.post('/register', (req, res) => {
  const f = req.body;
  const errors = [];
  if (!f.given_name || !f.family_name) errors.push('Please enter your full name.');
  if (!f.dob) errors.push('Please enter your date of birth.');
  if (!/^04\d{8}$/.test(f.mobile || '')) errors.push('Mobile must be an Australian mobile number, e.g. 0412345678.');
  if (!/^[2-6]\d{9}$/.test(f.medicare_no || '')) errors.push('Medicare number must be 10 digits and start with 2-6.');
  if (!f.email || !f.email.includes('@')) errors.push('Please enter a valid email address.');
  if ((f.password || '').length < 8) errors.push('Password must be at least 8 characters.');
  // FR-02: duplicate detection on name + DOB
  if (errors.length === 0) {
    const dup = db.prepare('SELECT id FROM patients WHERE family_name = ? AND given_name = ? AND dob = ?')
      .get(f.family_name, f.given_name, f.dob);
    if (dup) errors.push('An account with this name and date of birth already exists. Please contact the clinic.');
  }
  if (errors.length) return res.status(400).render('register', ctx(req, { errors, form: f }));
  try {
    const r = db.prepare(`INSERT INTO patients (given_name, family_name, dob, mobile, email, medicare_no, password_hash)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(f.given_name, f.family_name, f.dob, f.mobile, f.email, f.medicare_no, hashPassword(f.password));
    req.session.patientId = Number(r.lastInsertRowid);
    res.redirect('/search');
  } catch (e) {
    res.status(400).render('register', ctx(req, { errors: ['That email address is already registered.'], form: f }));
  }
});

// ---------- Sign in / out ----------
app.get('/login', (req, res) => res.render('login', ctx(req, { error: null })));
app.post('/login', (req, res) => {
  const p = db.prepare('SELECT * FROM patients WHERE email = ?').get(req.body.email || '');
  if (!p || !verifyPassword(req.body.password || '', p.password_hash)) {
    return res.status(401).render('login', ctx(req, { error: 'Email or password is incorrect.' }));
  }
  req.session.patientId = p.id;
  res.redirect('/search');
});
app.get('/staff', (req, res) => res.render('staff_login', ctx(req, { error: null })));
app.post('/staff', (req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE username = ?').get(req.body.username || '');
  if (!s || !verifyPassword(req.body.password || '', s.password_hash)) {
    return res.status(401).render('staff_login', ctx(req, { error: 'Username or password is incorrect.' }));
  }
  req.session.staffId = s.id;
  res.redirect('/reception');
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ---------- FR-03: availability search ----------
function freeSlots(date, clinicianId) {
  let sql = `
    SELECT s.*, c.name AS clinician_name, c.specialty
    FROM slots s JOIN clinicians c ON c.id = s.clinician_id
    WHERE s.is_reserved = 0
      AND substr(s.start_time, 1, 10) = ?
      AND s.start_time > ?
      AND (s.lock_expires_at IS NULL OR s.lock_expires_at < ?)`;
  const params = [date, nowStr(), nowStr()];
  if (clinicianId) { sql += ' AND s.clinician_id = ?'; params.push(clinicianId); }
  sql += ' ORDER BY s.clinician_id, s.start_time';
  return db.prepare(sql).all(...params);
}

app.get('/search', requirePatient, (req, res) => {
  const date = req.query.date || todayStr();
  const clinicianId = req.query.clinician ? Number(req.query.clinician) : null;
  const typeId = req.query.type ? Number(req.query.type) : null;
  const clinicians = db.prepare('SELECT * FROM clinicians WHERE is_active = 1').all();
  const types = db.prepare('SELECT * FROM appointment_types WHERE active = 1').all();
  const slots = freeSlots(date, clinicianId);
  res.render('search', ctx(req, { date, clinicianId, typeId, clinicians, types, slots }));
});

// ---------- FR-04: five-minute slot lock, then confirm ----------
app.post('/slots/:id/lock', requirePatient, (req, res) => {
  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(req.params.id);
  if (!slot || slot.is_reserved) {
    return res.render('message', ctx(req, { title: 'Slot no longer available',
      body: 'Sorry, that time has just been taken. Please choose another slot.', tone: 'warn' }));
  }
  if (slot.lock_expires_at && slot.lock_expires_at >= nowStr() && slot.locked_by !== req.session.patientId) {
    return res.render('message', ctx(req, { title: 'Slot being booked by someone else',
      body: 'Another patient is currently completing a booking for this slot. It will be released in a few minutes if they do not proceed.', tone: 'warn' }));
  }
  const expiry = new Date(Date.now() + 5 * 60 * 1000);
  const expiryStr = `${expiry.getFullYear()}-${pad(expiry.getMonth() + 1)}-${pad(expiry.getDate())} ${pad(expiry.getHours())}:${pad(expiry.getMinutes())}`;
  db.prepare('UPDATE slots SET lock_expires_at = ?, locked_by = ? WHERE id = ?')
    .run(expiryStr, req.session.patientId, slot.id);
  res.redirect(`/confirm/${slot.id}?type=${req.body.type || 1}`);
});

app.get('/confirm/:slotId', requirePatient, (req, res) => {
  const slot = db.prepare(`SELECT s.*, c.name AS clinician_name FROM slots s
                           JOIN clinicians c ON c.id = s.clinician_id WHERE s.id = ?`).get(req.params.slotId);
  const types = db.prepare('SELECT * FROM appointment_types WHERE active = 1').all();
  if (!slot) return res.redirect('/search');
  res.render('confirm', ctx(req, { slot, types, typeId: Number(req.query.type) || 1 }));
});

// ---------- FR-05: booking with double-booking rejection ----------
app.post('/book', requirePatient, (req, res) => {
  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(req.body.slot_id);
  if (!slot) return res.redirect('/search');
  try {
    const r = db.prepare(`INSERT INTO appointments (slot_id, patient_id, clinician_id, type_id, start_time, booking_channel)
                          VALUES (?, ?, ?, ?, ?, 'online')`)
      .run(slot.id, req.session.patientId, slot.clinician_id, Number(req.body.type_id), slot.start_time);
    db.prepare('UPDATE slots SET is_reserved = 1, lock_expires_at = NULL, locked_by = NULL WHERE id = ?').run(slot.id);
    res.redirect(`/booked/${r.lastInsertRowid}`);
  } catch (e) {
    // UNIQUE (clinician_id, start_time) or UNIQUE slot_id violated: someone got there first
    res.status(409).render('message', ctx(req, { title: 'Booking could not be completed',
      body: 'That slot was booked by another patient a moment ago, so a double booking was prevented. Please search again and choose a different time.', tone: 'error' }));
  }
});

app.get('/booked/:id', requirePatient, (req, res) => {
  const appt = db.prepare(`
    SELECT a.*, c.name AS clinician_name, t.name AS type_name, t.duration_min
    FROM appointments a JOIN clinicians c ON c.id = a.clinician_id
    JOIN appointment_types t ON t.id = a.type_id
    WHERE a.id = ? AND a.patient_id = ?`).get(req.params.id, req.session.patientId);
  if (!appt) return res.redirect('/appointments');
  res.render('booked', ctx(req, { appt }));
});

// ---------- FR-12: my appointments, FR-07/08: cancellation ----------
app.get('/appointments', requirePatient, (req, res) => {
  const all = db.prepare(`
    SELECT a.*, c.name AS clinician_name, t.name AS type_name
    FROM appointments a JOIN clinicians c ON c.id = a.clinician_id
    JOIN appointment_types t ON t.id = a.type_id
    WHERE a.patient_id = ? ORDER BY a.start_time DESC`).all(req.session.patientId);
  const upcoming = all.filter(a => a.start_time > nowStr() && a.status === 'booked');
  const past = all.filter(a => a.start_time <= nowStr() || a.status !== 'booked');
  res.render('appointments', ctx(req, {
    upcoming, past, hoursUntil,
    notice: req.query.cancelled ? 'Your appointment has been cancelled and the slot released.' : null,
    error: req.query.tooLate ? 'Appointments within two hours of the start time cannot be cancelled online. Please phone the clinic.' : null,
  }));
});

app.post('/appointments/:id/cancel', requirePatient, (req, res) => {
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ? AND patient_id = ?')
    .get(req.params.id, req.session.patientId);
  if (!appt || appt.status !== 'booked') return res.redirect('/appointments');
  if (hoursUntil(appt.start_time) < 2) return res.redirect('/appointments?tooLate=1'); // FR-07
  db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(appt.id);
  db.prepare('UPDATE slots SET is_reserved = 0 WHERE id = ?').run(appt.slot_id);   // FR-08
  res.redirect('/appointments?cancelled=1');
});

// ---------- Reception: FR-13 phone bookings, FR-15 attendance, FR-14 audit ----------
app.get('/reception', requireStaff, (req, res) => {
  const date = req.query.date || todayStr();
  const appts = db.prepare(`
    SELECT a.*, c.name AS clinician_name, t.name AS type_name,
           p.given_name || ' ' || p.family_name AS patient_name, p.mobile
    FROM appointments a JOIN clinicians c ON c.id = a.clinician_id
    JOIN appointment_types t ON t.id = a.type_id
    JOIN patients p ON p.id = a.patient_id
    WHERE substr(a.start_time, 1, 10) = ? AND a.status != 'cancelled'
    ORDER BY a.start_time`).all(date);
  const patients = db.prepare('SELECT id, given_name, family_name FROM patients ORDER BY family_name').all();
  const clinicians = db.prepare('SELECT * FROM clinicians WHERE is_active = 1').all();
  const types = db.prepare('SELECT * FROM appointment_types WHERE active = 1').all();
  const bookDate = req.query.bookDate || date;
  const bookClinician = req.query.bookClinician ? Number(req.query.bookClinician) : null;
  const slots = freeSlots(bookDate, bookClinician);
  const auditRows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 8').all();
  res.render('reception', ctx(req, {
    date, appts, patients, clinicians, types, slots, bookDate, bookClinician, auditRows, today: todayStr(),
    notice: req.query.done || null,
  }));
});

app.post('/reception/book', requireStaff, (req, res) => {
  const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(req.body.slot_id);
  if (!slot || slot.is_reserved) return res.redirect('/reception?done=Slot no longer available');
  try {
    const r = db.prepare(`INSERT INTO appointments (slot_id, patient_id, clinician_id, type_id, start_time, booking_channel)
                          VALUES (?, ?, ?, ?, ?, 'phone')`)
      .run(slot.id, Number(req.body.patient_id), slot.clinician_id, Number(req.body.type_id), slot.start_time);
    db.prepare('UPDATE slots SET is_reserved = 1 WHERE id = ?').run(slot.id);
    audit('staff', req.session.staffId, 'phone booking created', `appointment #${r.lastInsertRowid}`); // FR-14
    res.redirect('/reception?done=Phone booking created');
  } catch (e) {
    res.redirect('/reception?done=Double booking prevented - slot already taken');
  }
});

app.post('/reception/status/:id', requireStaff, (req, res) => {
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  const allowed = ['arrived', 'attended', 'dna'];
  if (!appt || !allowed.includes(req.body.status)) return res.redirect('/reception');
  // FR-15: status changeable until end of the appointment day
  if (appt.start_time.slice(0, 10) > todayStr()) return res.redirect('/reception?done=Cannot set attendance for a future day');
  db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(req.body.status, appt.id);
  audit('staff', req.session.staffId, `status set to ${req.body.status}`, `appointment #${appt.id}`); // FR-14
  res.redirect(`/reception?date=${appt.start_time.slice(0, 10)}&done=Status updated`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MediBook prototype running on http://localhost:${PORT}`));
