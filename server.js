const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const axios = require('axios');

// Database Setup
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./fitbit.db', (err) => {
  if (err) console.error('DB Init Error:', err.message);
  else console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS daily_summary (
    date TEXT PRIMARY KEY,
    steps INTEGER,
    resting_hr INTEGER,
    sleep_minutes INTEGER,
    weight REAL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS intraday_json (
    date TEXT PRIMARY KEY,
    json_data TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS health_data_cache (
    date TEXT PRIMARY KEY,
    data TEXT,
    created_at INTEGER
  )`);
});

// Helper to generate date array
const getDatesInRange = (startDateStr, days) => {
  const dates = [];
  // Go backwards from start date
  for (let i = 0; i < days; i++) {
    const d = new Date(startDateStr);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates.reverse();
};

// Middleware
app.use(helmet());
app.use(cors({
  origin: 'http://localhost:5173', // Vite default port
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Fitbit Health Dashboard API' });
});

// Fitbit OAuth routes
app.get('/auth/fitbit', (req, res) => {
  const scope = 'activity heartrate nutrition profile settings sleep weight';
  const fitbitAuthUrl = `https://www.fitbit.com/oauth2/authorize?client_id=${process.env.FITBIT_CLIENT_ID}&response_type=code&scope=${scope}&redirect_uri=${process.env.FITBIT_REDIRECT_URI}`;
  res.redirect(fitbitAuthUrl);
});

app.get('/auth/fitbit/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Authorization code missing' });
  }

  try {
    const tokenResponse = await axios.post('https://api.fitbit.com/oauth2/token',
      new URLSearchParams({
        client_id: process.env.FITBIT_CLIENT_ID,
        grant_type: 'authorization_code',
        redirect_uri: process.env.FITBIT_REDIRECT_URI,
        code
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`).toString('base64')}`
        }
      }
    );

    const { access_token, user_id } = tokenResponse.data;

    // Redirect to frontend with token
    // Note: In production, use secure cookies or a temporary code exchange. 
    // For this dashboard, passing via query param is acceptable for MVP.
    res.redirect(`http://localhost:5173/dashboard?token=${access_token}&user=${user_id}`);

  } catch (error) {
    const errorDetail = error.response?.data?.errors?.[0]?.message || error.response?.data || error.message;
    console.error('Error exchanging token:', errorDetail);
    res.status(500).json({ error: 'Failed to authenticate with Fitbit', details: errorDetail });
  }
});

// History/Chart data endpoint
app.get('/api/activity-history', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const { date, range, type = 'steps' } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  const isToday = targetDate === new Date().toISOString().split('T')[0];

  console.log(`[ActivityHistory] Request: ${type} | ${range} | ${targetDate}`);

  if (!token) {
    console.warn('[ActivityHistory] No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const headers = { 'Authorization': `Bearer ${token}` };

    // --- DAY VIEW (INTRADAY) ---
    if (range === 'day' && type === 'steps') {
      if (!isToday) {
        const cached = await new Promise((resolve) => {
          db.get("SELECT json_data FROM intraday_json WHERE date = ?", [targetDate], (err, row) => resolve(row));
        });
        if (cached) {
          console.log(`[ActivityHistory] DB HIT: Intraday Steps for ${targetDate}`);
          return res.json(JSON.parse(cached.json_data));
        }
      }

      const apiUrl = `https://api.fitbit.com/1/user/-/activities/steps/date/${targetDate}/1d/15min.json`;
      console.log(`[ActivityHistory] API FETCH: ${apiUrl}`);

      try {
        const response = await axios.get(apiUrl, { headers });
        const data = response.data;
        let result = [];
        const intraday = data['activities-steps-intraday']?.dataset;
        if (intraday && intraday.length > 0) {
          result = intraday.map(item => ({ label: item.time, value: item.value }));
        } else {
          result = data['activities-steps']?.map(item => ({ label: 'Total', value: Number(item.value) })) || [];
        }

        console.log(`[ActivityHistory] API SUCCESS: ${result.length} items returned`);
        db.run("INSERT OR REPLACE INTO intraday_json (date, json_data) VALUES (?, ?)", [targetDate, JSON.stringify(result)]);
        return res.json(result);
      } catch (err) {
        const errorDetail = err.response?.data?.errors?.[0]?.message || err.response?.data || err.message;
        console.error(`[ActivityHistory] API ERROR (Intraday):`, errorDetail);
        if (err.response?.status === 403) return res.json([]);
        throw err;
      }
    }

    // --- WEEK / MONTH VIEW (OR NON-STEPS DAY) ---
    let dbColumn, urlPath, responseKey, valueExtractor;

    switch (type) {
      case 'heart':
        dbColumn = 'resting_hr';
        urlPath = 'activities/heart';
        responseKey = 'activities-heart';
        valueExtractor = (item) => item.value.restingHeartRate || 0;
        break;
      case 'sleep':
        dbColumn = 'sleep_minutes';
        break;
      case 'weight':
        dbColumn = 'weight';
        urlPath = 'body/log/weight';
        responseKey = 'body-weight';
        valueExtractor = (item) => Number(item.value);
        break;
      case 'steps':
      default:
        dbColumn = 'steps';
        urlPath = 'activities/steps';
        responseKey = 'activities-steps';
        valueExtractor = (item) => Number(item.value);
        break;
    }

    const daysCount = range === 'week' ? 7 : (range === 'month' ? 30 : 1);
    const dateList = getDatesInRange(targetDate, daysCount);

    const dbRows = await new Promise((resolve) => {
      db.all(
        `SELECT date, ${dbColumn} as val FROM daily_summary WHERE date IN (${dateList.map(() => '?').join(',')})`,
        dateList,
        (err, rows) => resolve(rows || [])
      );
    });

    const dbMap = {};
    dbRows.forEach(row => dbMap[row.date] = row.val);

    const pastDates = isToday ? dateList.slice(0, -1) : dateList;
    const missingCount = pastDates.filter(d => dbMap[d] == null).length;

    if (missingCount === 0 && !isToday && dateList.length > 0) {
      console.log(`[ActivityHistory] DB HIT: ${range} ${type} for ${targetDate}`);
      const result = dateList.map(d => ({ label: d.slice(range === 'week' ? 5 : 8), value: dbMap[d] || 0 }));
      return res.json(result);
    }

    let apiUrl;
    if (type === 'sleep') {
      const startDate = dateList[0];
      const endDate = dateList[dateList.length - 1];
      apiUrl = `https://api.fitbit.com/1.2/user/-/sleep/date/${startDate}/${endDate}.json`;
    } else {
      const rangeParam = range === 'week' ? '7d' : (range === 'month' ? '30d' : '1d');
      apiUrl = `https://api.fitbit.com/1/user/-/${urlPath}/date/${targetDate}/${rangeParam}.json`;
    }

    console.log(`[ActivityHistory] API FETCH: ${apiUrl}`);
    const response = await axios.get(apiUrl, { headers });

    const result = [];
    const upserts = [];

    if (type === 'sleep') {
      const sleepLog = response.data.sleep || [];
      const sleepMap = {};
      sleepLog.forEach(log => {
        sleepMap[log.dateOfSleep] = (sleepMap[log.dateOfSleep] || 0) + log.minutesAsleep;
      });
      dateList.forEach(d => {
        const val = sleepMap[d] || 0;
        result.push({ label: d.slice(range === 'week' ? 5 : 8), value: val });
        upserts.push({ date: d, value: val });
      });
    } else {
      const series = response.data[responseKey] || [];
      const seriesMap = {};
      series.forEach(item => seriesMap[item.dateTime] = valueExtractor(item));
      dateList.forEach(d => {
        const val = seriesMap[d] || 0;
        result.push({ label: d.slice(range === 'week' ? 5 : 8), value: val });
        upserts.push({ date: d, value: val });
      });
    }

    console.log(`[ActivityHistory] API SUCCESS: ${result.length} points | Cacheing ${upserts.length} items`);

    db.serialize(() => {
      const stmtInsert = db.prepare(`INSERT OR IGNORE INTO daily_summary (date) VALUES (?)`);
      const stmtUpdate = db.prepare(`UPDATE daily_summary SET ${dbColumn} = ? WHERE date = ?`);
      db.run("BEGIN TRANSACTION");
      upserts.forEach(item => {
        stmtInsert.run(item.date);
        stmtUpdate.run(item.value, item.date);
      });
      db.run("COMMIT");
      stmtInsert.finalize();
      stmtUpdate.finalize();
    });

    res.json(result);

  } catch (error) {
    const errorDetail = error.response?.data?.errors?.[0]?.message || error.response?.data || error.message;
    console.error(`[ActivityHistory] CRITICAL ERROR:`, errorDetail);
    res.status(500).json({ error: `Failed to fetch ${type} data`, details: errorDetail });
  }
});

// API routes for health data
app.get('/api/health-data', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const headers = { 'Authorization': `Bearer ${token}` };
    const today = req.query.date || new Date().toISOString().split('T')[0];
    const isToday = today === new Date().toISOString().split('T')[0];

    // Check cache for non-today dates
    if (!isToday) {
      const cached = await new Promise((resolve) => {
        db.get("SELECT data FROM health_data_cache WHERE date = ?", [today], (err, row) => {
          resolve(row);
        });
      });
      if (cached) {
        console.log(`[API-CACHE] Health data hit for ${today}`);
        return res.json(JSON.parse(cached.data));
      }
    }

    console.log(`[API-FETCH] Full Health Data for ${today}`);

    // Helper to wrap individual fetches
    const safeFetch = async (url) => {
      try {
        const res = await axios.get(url, { headers });
        return res.data;
      } catch (err) {
        const errorDetail = err.response?.data?.errors?.[0]?.message || err.response?.data || err.message;
        console.error(`[API-ERROR] Fetch failed for ${url}:`, errorDetail);
        return null;
      }
    };

    // Fetch multiple endpoints in parallel with error handling
    const [
      profile,
      activity,
      heart,
      sleep,
      nutrition,
      body,
      devices,
      water
    ] = await Promise.all([
      safeFetch('https://api.fitbit.com/1/user/-/profile.json'),
      safeFetch(`https://api.fitbit.com/1/user/-/activities/date/${today}.json`),
      safeFetch(`https://api.fitbit.com/1/user/-/activities/heart/date/${today}/1d.json`),
      safeFetch(`https://api.fitbit.com/1.2/user/-/sleep/date/${today}.json`),
      safeFetch(`https://api.fitbit.com/1/user/-/foods/log/date/${today}.json`),
      safeFetch(`https://api.fitbit.com/1/user/-/body/log/weight/date/${today}.json`),
      safeFetch('https://api.fitbit.com/1/user/-/devices.json'),
      safeFetch(`https://api.fitbit.com/1/user/-/foods/log/water/date/${today}.json`)
    ]);

    const result = {
      profile: profile?.user || null,
      activity: activity || null,
      heartRate: heart ? heart['activities-heart'] : null,
      sleep: sleep?.sleep || null,
      sleepSummary: sleep?.summary || null,
      nutrition: {
        food: nutrition || null,
        water: water || null
      },
      body: body || null,
      devices: devices || null
    };

    // Cache the result for past dates
    if (!isToday) {
      db.run(
        "INSERT OR REPLACE INTO health_data_cache (date, data, created_at) VALUES (?, ?, ?)",
        [today, JSON.stringify(result), Math.floor(Date.now() / 1000)]
      );
    }

    res.json(result);

  } catch (error) {
    const errorDetail = error.response?.data?.errors?.[0]?.message || error.response?.data || error.message;
    console.error('Critical failure in /api/health-data:', errorDetail);
    res.status(500).json({ error: 'Failed to fetch Fitbit data', details: errorDetail });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
