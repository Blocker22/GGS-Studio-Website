const RATES = {
  hourly: 350,
  addons: {
    room: 0,
    recording: 300,
    mixing: 200,
    both: 500,
  },
};

const SERVICE_LABELS = {
  room: 'Room only',
  recording: 'Room + Recording',
  mixing: 'Room + Mixing',
  both: 'Room + Recording + Mixing',
};

const STEP_MINUTES = 30;

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function isOnStep(time) {
  return toMinutes(time) % STEP_MINUTES === 0;
}

function computeDurationHours(startTime, endTime) {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (end <= start) return null;
  const rawHours = (end - start) / 60;
  return Math.ceil(rawHours * 10) / 10;
}

function computePrice(service, durationHours) {
  const addon = RATES.addons[service];
  if (addon === undefined) return null;
  return Math.ceil(RATES.hourly * durationHours + addon);
}

module.exports = { RATES, SERVICE_LABELS, STEP_MINUTES, isOnStep, computeDurationHours, computePrice };
