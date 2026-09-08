# MediBook

Prototype of an online appointment booking system for small Australian general practices.
Built for ITS205 Software Engineering (Term Project, Assessment B) at NAPS, based on the
requirements documented in the Assessment A SRS.

## Features implemented

- Patient registration with Medicare number and mobile validation, plus duplicate detection (FR-01, FR-02)
- Availability search by date and clinician, excluding booked and past slots (FR-03)
- Five-minute slot hold on selection, and rejection of double bookings at the database level (FR-04, FR-05)
- Online cancellation up to two hours before the appointment, with the slot released back to the pool (FR-07, FR-08)
- "My appointments" history with statuses (FR-12)
- Reception desk: day list, phone bookings on behalf of patients, attendance marking, audit log (FR-13, FR-14, FR-15)
- Separate patient and staff sign-in (FR-20, partial)

## Stack

Node.js 24, Express 4, EJS templates, SQLite (via the built-in `node:sqlite` module).
No build step and no native dependencies.

## Running it

```
npm install
npm run seed   # creates clinicians, appointment types and two weeks of slots
npm start      # http://localhost:3000
```

Staff login for the reception desk: `reception` / `reception123`.
Register any patient account through the Register page.

## Not in the prototype

SMS/email delivery, the cancellation waitlist, reporting, clinician roster self-service and
appointment-type administration are documented in the SRS but out of scope for this prototype.
