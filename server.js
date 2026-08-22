const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RATES, SERVICE_LABELS, isOnStep, computeDurationHours, computePrice } = require('./pricing');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

app.use(express.json());
app.use(express.static(__dirname));

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  if (!fs.existsSync(BOOKINGS_FILE)) fs.writeFileSync(BOOKINGS_FILE, '[]');
}

function readBookings() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
}

function writeBookings(bookings) {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
}

app.get('/api/config', (req, res) => {
  res.json({ rates: RATES, serviceLabels: SERVICE_LABELS });
});

app.get('/api/bookings', (req, res) => {
  res.json(readBookings());
});

app.post('/api/bookings', (req, res) => {
  const { name, email, service, date, startTime, endTime } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  if (!SERVICE_LABELS[service]) {
    return res.status(400).json({ error: 'Please choose a valid service.' });
  }
  if (typeof date !== 'string' || !date) {
    return res.status(400).json({ error: 'Please choose a date.' });
  }
  if (typeof startTime !== 'string' || !TIME_RE.test(startTime) || !isOnStep(startTime)) {
    return res.status(400).json({ error: 'Please choose a start time in 30-minute increments.' });
  }
  if (typeof endTime !== 'string' || !TIME_RE.test(endTime) || !isOnStep(endTime)) {
    return res.status(400).json({ error: 'Please choose an end time in 30-minute increments.' });
  }

  const duration = computeDurationHours(startTime, endTime);
  if (!duration) {
    return res.status(400).json({ error: 'End time must be later than the start time.' });
  }
  const price = computePrice(service, duration);

  const booking = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: email.trim(),
    service,
    serviceLabel: SERVICE_LABELS[service],
    date,
    startTime,
    endTime,
    durationHours: duration,
    price,
    createdAt: new Date().toISOString(),
  };

  const bookings = readBookings();
  bookings.push(booking);
  writeBookings(bookings);

  res.status(201).json(booking);
});

app.listen(PORT, () => {
  console.log(`GGS Studio server running at http://localhost:${PORT}`);
});
