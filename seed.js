// Seeds clinicians, appointment types, a reception staff account, and two weeks
// of availability slots generated from each clinician's weekly roster (FR-16 is
// represented by the roster structure below; a self-service roster editor is a
// later-sprint item and out of prototype scope).
const db = require('./db');
const { hashPassword } = require('./auth');

db.exec('DELETE FROM audit_log; DELETE FROM appointments; DELETE FROM slots;');
db.exec('DELETE FROM appointment_types; DELETE FROM clinicians; DELETE FROM staff;');

const clinicians = [
  { name: 'Dr Priya Sharma', specialty: 'General Practice' },
  { name: 'Dr Tom Nguyen', specialty: 'General Practice' },
  { name: 'Dr Sarah McKay', specialty: 'Womens Health' },
];
const insCl = db.prepare('INSERT INTO clinicians (name, specialty) VALUES (?, ?)');
clinicians.forEach(c => insCl.run(c.name, c.specialty));

const types = [
  { name: 'Standard consultation', duration: 15, colour: '#4a90d9' },
  { name: 'Long consultation', duration: 30, colour: '#7b6fb0' },
  { name: 'New patient visit', duration: 30, colour: '#4aa564' },
];
const insTy = db.prepare('INSERT INTO appointment_types (name, duration_min, colour) VALUES (?, ?, ?)');
types.forEach(t => insTy.run(t.name, t.duration, t.colour));

db.prepare('INSERT INTO staff (username, display_name, role, password_hash) VALUES (?, ?, ?, ?)')
  .run('reception', 'Front Desk', 'reception', hashPassword('reception123'));

// Weekly roster per clinician: day-of-week (1=Mon..5=Fri) -> [ [startHH, endHH], ... ]
const roster = {
  1: { 1: [[9, 12], [14, 17]], 2: [[9, 12], [14, 17]], 3: [[9, 12]], 4: [[9, 12], [14, 17]], 5: [[9, 13]] },
  2: { 1: [[14, 18]], 2: [[9, 12], [14, 17]], 3: [[9, 12], [14, 17]], 4: [[14, 18]], 5: [[9, 12]] },
  3: { 2: [[9, 13]], 3: [[13, 17]], 4: [[9, 13]], 5: [[9, 12], [14, 16]] },
};

function pad(n) { return String(n).padStart(2, '0'); }

const insSlot = db.prepare('INSERT INTO slots (clinician_id, start_time) VALUES (?, ?)');
const today = new Date();
let count = 0;
for (let d = 0; d < 14; d++) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
  const dow = day.getDay(); // 0=Sun..6=Sat
  if (dow === 0 || dow === 6) continue;
  const dateStr = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  for (const [clinicianId, week] of Object.entries(roster)) {
    const blocks = week[dow] || [];
    for (const [from, to] of blocks) {
      for (let h = from; h < to; h++) {
        for (const m of [0, 15, 30, 45]) {
          insSlot.run(Number(clinicianId), `${dateStr} ${pad(h)}:${pad(m)}`);
          count++;
        }
      }
    }
  }
}

console.log(`Seeded ${clinicians.length} clinicians, ${types.length} appointment types, ${count} slots.`);
console.log('Reception login: reception / reception123');
