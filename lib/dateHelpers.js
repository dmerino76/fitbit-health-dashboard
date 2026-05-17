// lib/dateHelpers.js
const dayStart = (dateStr) => new Date(dateStr + 'T00:00:00').getTime();
const dayEnd   = (dateStr) => new Date(dateStr + 'T23:59:59').getTime();
const toRFC3339 = (ms)     => new Date(ms).toISOString();

function getDatesInRange(startDate, endDate) {
  // returns array of 'YYYY-MM-DD' strings from startDate to endDate inclusive
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates = [];
  let current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

module.exports = { dayStart, dayEnd, toRFC3339, getDatesInRange };