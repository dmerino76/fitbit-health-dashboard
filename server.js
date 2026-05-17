const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const axios = require('axios');
const { google } = require('googleapis');

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
  db.run(`CREATE TABLE IF NOT EXISTS user_tokens (
    user_id TEXT PRIMARY KEY,
    refresh_token TEXT,
    updated_at INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS cache_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  // poisoning guard moved to CacheStore.setSnapshot
});

const CacheStore = require('./lib/cache')(db);

// Google OAuth2 Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.heart_rate.read',
  'https://www.googleapis.com/auth/fitness.sleep.read',
  'https://www.googleapis.com/auth/fitness.nutrition.read',
  'https://www.googleapis.com/auth/fitness.body.read',
  'https://www.googleapis.com/auth/fitness.location.read',
  'https://www.googleapis.com/auth/userinfo.profile',
];

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

// Google OAuth routes
app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Authorization code missing' });
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    const { access_token, refresh_token } = tokens;

    // Store refresh token for automatic historical caching
    db.run(
      'INSERT OR REPLACE INTO user_tokens (user_id, refresh_token, updated_at) VALUES (?, ?, ?)',
      ['default_user', refresh_token, Math.floor(Date.now() / 1000)],
      (err) => {
        if (err) console.error('[AUTH] Failed to store refresh token:', err);
        else console.log('[AUTH] Refresh token stored for automatic caching');
      }
    );

    res.redirect(`http://localhost:5173/dashboard?token=${access_token}&refresh=${refresh_token}`);
  } catch (error) {
    const errorDetail = error.message || error.toString();
    console.error('Error exchanging token:', errorDetail);
    res.status(500).json({ error: 'Failed to authenticate with Google', details: errorDetail });
  }
});

// Helper to refresh expired access tokens
const getValidToken = async (accessToken, refreshToken) => {
  try {
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();
    return credentials.access_token;
  } catch (error) {
    console.error('Token refresh failed:', error.message);
    throw error;
  }
};

// Helper to convert date string to epoch milliseconds
const dayStart = (dateStr) => new Date(dateStr + 'T00:00:00').getTime();
const dayEnd = (dateStr) => new Date(dateStr + 'T23:59:59').getTime();
const toRFC3339 = (ms) => new Date(ms).toISOString();

// Activity history endpoint (charts: day/week/month views)
app.get('/api/activity-history', async (req, res) => {
  const authHeader = req.headers.authorization?.split(' ')[1];
  const refreshToken = req.query.refresh;
  const { date, range, type = 'steps' } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  const isToday = targetDate === new Date().toISOString().split('T')[0];

  console.log(`[ActivityHistory] Request: ${type} | ${range} | ${targetDate}`);

  if (!authHeader) {
    console.warn('[ActivityHistory] No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    let accessToken = authHeader;
    if (refreshToken) {
      try {
        accessToken = await getValidToken(authHeader, refreshToken);
      } catch (err) {
        console.warn('[ActivityHistory] Token refresh failed, using provided token');
      }
    }

    const headers = { 'Authorization': `Bearer ${accessToken}` };

    // --- DAY VIEW (INTRADAY STEPS) ---
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

      try {
        console.log(`[ActivityHistory] API FETCH: Intraday steps for ${targetDate}`);

        // Fall back to daily total (intraday requires specific data source ID from user's data)
        const dailyAggregate = await axios.post(
          'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
          {
            aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
            bucketByTime: { durationMillis: 86400000 },
            startTimeMillis: dayStart(targetDate),
            endTimeMillis: dayEnd(targetDate)
          },
          { headers }
        );

        const totalSteps = dailyAggregate.data?.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.intVal || 0;
        const result = [{ label: 'Total', value: totalSteps }];

        console.log(`[ActivityHistory] API SUCCESS: ${result.length} items returned`);
        db.run("INSERT OR REPLACE INTO intraday_json (date, json_data) VALUES (?, ?)", [targetDate, JSON.stringify(result)]);
        return res.json(result);
      } catch (err) {
        console.error(`[ActivityHistory] API ERROR (Intraday):`, err.response?.data || err.message);
        return res.json([]);
      }
    }

    // --- DAY VIEW: INTRADAY HEART RATE ---
    if (range === 'day' && type === 'heart') {
      const cached = await new Promise(resolve =>
        db.get('SELECT data FROM health_data_cache WHERE date = ?', [targetDate], (_, row) => resolve(row))
      );
      if (cached?.data) {
        try {
          const parsed = JSON.parse(cached.data);
          const intraday = parsed.heartRate?.[0]?.intraday ?? [];
          if (intraday.length > 0) {
            return res.json(intraday.map(p => ({ label: p.time, value: p.value })));
          }
        } catch (_) { /* fall through */ }
      }
      try {
        const resp = await axios.post(
          'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
          {
            aggregateBy: [{ dataTypeName: 'com.google.heart_rate.bpm' }],
            bucketByTime: { durationMillis: 900000 },
            startTimeMillis: dayStart(targetDate),
            endTimeMillis: dayEnd(targetDate),
          },
          { headers }
        );
        const points = [];
        (resp.data.bucket ?? []).forEach(bucket => {
          const bpmVal = bucket.dataset?.[0]?.point?.[0]?.value?.[0]?.fpVal;
          if (!bpmVal) return;
          const d = new Date(parseInt(bucket.startTimeMillis));
          const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          points.push({ label, value: Math.round(bpmVal) });
        });
        return res.json(points);
      } catch (_) {
        return res.json([]);
      }
    }

    // --- WEEK / MONTH VIEW ---
    let dataTypeName;
    switch (type) {
      case 'heart':
        dataTypeName = 'com.google.heart_rate.bpm';
        break;
      case 'sleep':
        dataTypeName = 'com.google.sleep.segment';
        break;
      case 'weight':
        dataTypeName = 'com.google.weight';
        break;
      case 'steps':
      default:
        dataTypeName = 'com.google.step_count.delta';
        break;
    }

    const daysCount = range === 'week' ? 7 : (range === 'month' ? 30 : 1);
    const dateList = getDatesInRange(targetDate, daysCount);

    // Check database cache
    const dbColumn = type === 'heart' ? 'resting_hr' : (type === 'sleep' ? 'sleep_minutes' : (type === 'weight' ? 'weight' : 'steps'));
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
      const result = dateList.map(d => ({ label: d, date: d, value: dbMap[d] || 0 }));
      return res.json(result);
    }

    console.log(`[ActivityHistory] API FETCH: Google Fit ${type} for ${range}`);

    const result = [];
    const upserts = [];

    if (type === 'sleep') {
      // Sleep uses sessions endpoint or fallback to cached data
      let sleepMap = {};

      try {
        const sleepResponse = await axios.get(
          'https://www.googleapis.com/fitness/v1/users/me/sessions',
          {
            params: {
              startTime: toRFC3339(dayStart(dateList[0])),
              endTime: toRFC3339(dayEnd(dateList[dateList.length - 1]))
            },
            headers
          }
        );

        sleepResponse.data.session?.forEach(session => {
          if (session.activityType === 72) { // parent sleep session = total duration
            const sessionDate = new Date(parseInt(session.startTimeMillis)).toISOString().split('T')[0];
            const minutes = Math.round((session.endTimeMillis - session.startTimeMillis) / 60000);
            sleepMap[sessionDate] = (sleepMap[sessionDate] || 0) + minutes;
          }
        });

        console.log('[ActivityHistory] Sleep data fetched from Google Fit');
      } catch (sleepErr) {
        console.warn('[ActivityHistory] Sleep API unavailable, using cached database data:', sleepErr.response?.data?.error?.message || sleepErr.message);

        // Fallback: Read from database cache
        const cachedSleep = await new Promise((resolve) => {
          db.all(
            `SELECT date, sleep_minutes as val FROM daily_summary WHERE date IN (${dateList.map(() => '?').join(',')})`,
            dateList,
            (err, rows) => resolve(rows || [])
          );
        });

        cachedSleep.forEach(row => {
          if (row.val) sleepMap[row.date] = row.val;
        });
      }

      dateList.forEach(d => {
        const val = sleepMap[d] || 0;
        result.push({ label: d, date: d, value: val });
        upserts.push({ date: d, value: val });
      });
    } else {
      // Other metrics use aggregate with rate limit retry
      let aggregateResponse = null;
      try {
        aggregateResponse = await axios.post(
          'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
          {
            aggregateBy: [{ dataTypeName }],
            bucketByTime: { durationMillis: 86400000 },
            startTimeMillis: dayStart(dateList[0]),
            endTimeMillis: dayEnd(dateList[dateList.length - 1])
          },
          { headers }
        );
      } catch (err) {
        if (err.response?.status === 429) {
          console.warn(`[ActivityHistory] Rate limited (429), using cached database data for ${type}`);
          // Fall back to database cache on rate limit
          dateList.forEach(d => {
            const val = dbMap[d] || 0;
            result.push({ label: d, date: d, value: val });
            upserts.push({ date: d, value: val });
          });
          return res.json(result);
        }
        throw err;
      }

      const valueMap = {};
      aggregateResponse.data?.bucket?.forEach((bucket, idx) => {
        const date = dateList[idx];
        let val = 0;
        const point = bucket.dataset?.[0]?.point?.[0];
        if (point?.value) {
          if (type === 'heart') {
            val = Math.round(point.value[0]?.fpVal || 0);
          } else if (type === 'weight') {
            val = Math.round((point.value[0]?.fpVal || 0) * 100) / 100;
          } else {
            val = Math.round(point.value[0]?.intVal || point.value[0]?.fpVal || 0);
          }
        }
        valueMap[date] = val;
      });

      dateList.forEach(d => {
        const val = valueMap[d] || 0;
        result.push({ label: d, date: d, value: val });
        upserts.push({ date: d, value: val });
      });
    }

    console.log(`[ActivityHistory] API SUCCESS: ${result.length} points | Caching ${upserts.length} items`);

    // Cache results
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
    const errorDetail = error.message || error.toString();
    console.error(`[ActivityHistory] CRITICAL ERROR:`, errorDetail);
    res.status(500).json({ error: `Failed to fetch ${type} data`, details: errorDetail });
  }
});

// API routes for health data
app.get('/api/health-data', async (req, res) => {
  const authHeader = req.headers.authorization?.split(' ')[1];
  const refreshToken = req.query.refresh;

  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    let accessToken = authHeader;
    const today = req.query.date || new Date().toISOString().split('T')[0];
    const isToday = today === new Date().toISOString().split('T')[0];

    // Check cache for non-today dates
    if (!isToday) {
      const cached = await CacheStore.getSnapshot(today);
      if (cached) {
        console.log(`[API-CACHE] Health data hit for ${today}`);
        return res.json(cached);
      }
    }

    // Refresh token if refresh_token provided and needed
    if (refreshToken) {
      try {
        accessToken = await getValidToken(authHeader, refreshToken);
      } catch (err) {
        console.warn('[API] Token refresh failed, using provided access token');
      }
    }

    console.log(`[API-FETCH] Full Health Data for ${today}`);

    const headers = { 'Authorization': `Bearer ${accessToken}` };

    // Helper for Google Fit aggregate requests
    const aggregate = async (dataTypeName) => {
      try {
        const response = await axios.post(
          'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
          {
            aggregateBy: [{ dataTypeName }],
            bucketByTime: { durationMillis: 86400000 },
            startTimeMillis: dayStart(today),
            endTimeMillis: dayEnd(today),
          },
          { headers }
        );
        return response.data;
      } catch (err) {
        console.error(`[API-ERROR] Aggregate failed for ${dataTypeName}:`, err.response?.data || err.message);
        return null;
      }
    };

    // Helper for 15-min intraday HR fetch
    const aggregateIntraday = async (dataTypeName) => {
      try {
        const response = await axios.post(
          'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
          {
            aggregateBy: [{ dataTypeName }],
            bucketByTime: { durationMillis: 900000 },
            startTimeMillis: dayStart(today),
            endTimeMillis: dayEnd(today),
          },
          { headers }
        );
        return response.data;
      } catch (err) {
        console.error(`[API-ERROR] Intraday aggregate failed for ${dataTypeName}:`, err.response?.data || err.message);
        return null;
      }
    };

    // Fetch aggregates in parallel (only supported data types)
    const [
      stepsData,
      caloriesData,
      distanceData,
      activeMinutesData,
      heartData,
      weightData,
      waterData,
      nutritionData,
      heartIntradayData
    ] = await Promise.all([
      aggregate('com.google.step_count.delta'),
      aggregate('com.google.calories.expended'),
      aggregate('com.google.distance.delta'),
      aggregate('com.google.active_minutes'),
      aggregate('com.google.heart_rate.bpm'),
      aggregate('com.google.weight'),
      aggregate('com.google.hydration'),
      aggregate('com.google.nutrition'),
      aggregateIntraday('com.google.heart_rate.bpm')
    ]);

    // Sleep data uses sessions endpoint
    let sleepData = { session: [] };
    try {
      const sleepResponse = await axios.get(
        'https://www.googleapis.com/fitness/v1/users/me/sessions',
        {
          params: {
            startTime: toRFC3339(dayStart(today)),
            endTime: toRFC3339(dayEnd(today))
          },
          headers
        }
      );
      sleepData = sleepResponse.data;
    } catch (err) {
      console.warn('[API-WARN] Sleep data unavailable:', err.response?.data?.error?.message || err.message);
    }

    // Fetch per-segment sleep stage data (no bucketByTime — each segment is its own point)
    const sleepSegmentsResp = await axios.post(
      'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
      {
        aggregateBy: [{ dataTypeName: 'com.google.sleep.segment' }],
        startTimeMillis: dayStart(today),
        endTimeMillis: dayEnd(today)
      },
      { headers }
    ).catch(() => null);

    // Map Google Fit response to Fitbit shape for frontend compatibility
    const result = fitGoogleToFitbitShape({
      steps: stepsData,
      calories: caloriesData,
      distance: distanceData,
      activeMinutes: activeMinutesData,
      heart: heartData,
      weight: weightData,
      water: waterData,
      nutrition: nutritionData,
      sleep: sleepData,
      sleepSegments: sleepSegmentsResp?.data,
      heartIntraday: heartIntradayData
    });

    // Cache the result for past dates
    if (!isToday) {
      await CacheStore.setSnapshot(today, result);
    }

    res.json(result);

  } catch (error) {
    const errorDetail = error.message || error.toString();
    console.error('Critical failure in /api/health-data:', errorDetail);
    res.status(500).json({ error: 'Failed to fetch health data', details: errorDetail });
  }
});

// Response shape adapter: Google Fit → Fitbit format
function fitGoogleToFitbitShape(googleData) {
  const extractValue = (data, index = 0) => {
    if (!data || !data.bucket || !data.bucket[index] || !data.bucket[index].dataset || !data.bucket[index].dataset[0]) {
      return null;
    }
    const points = data.bucket[index].dataset[0].point;
    if (!points || points.length === 0) return null;
    return points[0].value;
  };

  // Core metrics (supported by Google Fit)
  const stepsValue = extractValue(googleData.steps)?.[0]?.intVal || 0;
  const caloriesValue = extractValue(googleData.calories)?.[0]?.fpVal || 0;
  const distanceMeters = extractValue(googleData.distance)?.[0]?.fpVal || 0;
  const activeMinutes = extractValue(googleData.activeMinutes)?.[0]?.intVal || 0;
  const heartAllValues = extractValue(googleData.heart) || [];
  const weightValue = extractValue(googleData.weight)?.[0]?.fpVal || 0;
  const waterMl = extractValue(googleData.water)?.[0]?.fpVal || 0;

  // Compute heart rate zones using standard max HR formula
  const maxHR = 220 - 30; // Assuming age 30; could be dynamic per user
  const heartRateZones = [
    { name: 'Out of Zone', min: 0, max: Math.round(maxHR * 0.5), minutes: 0, color: '#6b7280' },
    { name: 'Fat Burn', min: Math.round(maxHR * 0.5), max: Math.round(maxHR * 0.7), minutes: 0, color: '#0ea5e9' },
    { name: 'Cardio', min: Math.round(maxHR * 0.7), max: Math.round(maxHR * 0.85), minutes: 0, color: '#f97316' },
    { name: 'Peak', min: Math.round(maxHR * 0.85), max: maxHR, minutes: 0, color: '#ef4444' }
  ];

  // Build intraday series from 15-min buckets and compute zone minutes
  const intraday = [];
  if (googleData.heartIntraday && googleData.heartIntraday.bucket) {
    googleData.heartIntraday.bucket.forEach(bucket => {
      const dataset = bucket.dataset?.[0];
      if (!dataset || !dataset.point || dataset.point.length === 0) return;
      const point = dataset.point[0];
      const bpmVal = point.value?.[0]?.fpVal;
      if (!bpmVal) return;

      // Format startTimeMillis as local HH:MM
      const d = new Date(parseInt(bucket.startTimeMillis));
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      intraday.push({ time: `${hh}:${mm}`, value: Math.round(bpmVal) });

      // Accumulate zone minutes (each non-empty bucket = 15 min)
      const bpm = Math.round(bpmVal);
      if (bpm >= heartRateZones[3].min) {
        heartRateZones[3].minutes += 15;
      } else if (bpm >= heartRateZones[2].min) {
        heartRateZones[2].minutes += 15;
      } else if (bpm >= heartRateZones[1].min) {
        heartRateZones[1].minutes += 15;
      } else {
        heartRateZones[0].minutes += 15;
      }
    });
  }

  // Derive min/avg/max from the intraday series (more reliable than the daily aggregate value array).
  // The daily com.google.heart_rate.bpm aggregate returns only value[0]=mean; [1]/[2] are not guaranteed.
  const intradayValues = intraday.map(p => p.value);
  const minBpm = intradayValues.length ? Math.min(...intradayValues) : 0;
  const maxBpm = intradayValues.length ? Math.max(...intradayValues) : 0;
  const avgBpm = intradayValues.length
    ? Math.round(intradayValues.reduce((s, v) => s + v, 0) / intradayValues.length)
    : (heartAllValues[0]?.fpVal ? Math.round(heartAllValues[0].fpVal) : 0);
  // Use daily minimum 15-min bucket as resting HR; fall back to daily aggregate mean
  const restingHR = minBpm || avgBpm || 0;

  // Sleep data processing
  let sleepTotal = 0;
  let sleepStages = { deep: 0, rem: 0, light: 0, wake: 0 };

  // totalMinutesAsleep comes from the parent sleep session (activityType=72)
  if (googleData.sleep && googleData.sleep.session) {
    googleData.sleep.session.forEach(session => {
      if (session.activityType === 72) {
        sleepTotal += Math.round((parseInt(session.endTimeMillis) - parseInt(session.startTimeMillis)) / 60000);
      }
    });
  }

  // Stage breakdown from com.google.sleep.segment dataset
  // intVal mapping: 1=wake, 3=out-of-bed (skip), 4=light, 5=deep, 6=rem
  const segmentPoints = googleData.sleepSegments?.bucket?.[0]?.dataset?.[0]?.point ?? [];
  segmentPoints.forEach(point => {
    const intVal = point.value?.[0]?.intVal;
    const durationMins = (parseInt(point.endTimeNanos) - parseInt(point.startTimeNanos)) / 60_000_000_000;
    switch (intVal) {
      case 1: sleepStages.wake  += durationMins; break;
      case 4: sleepStages.light += durationMins; break;
      case 5: sleepStages.deep  += durationMins; break;
      case 6: sleepStages.rem   += durationMins; break;
      // case 3: out-of-bed — skip
    }
  });

  // Round stage minutes to integers
  sleepStages.wake  = Math.round(sleepStages.wake);
  sleepStages.light = Math.round(sleepStages.light);
  sleepStages.deep  = Math.round(sleepStages.deep);
  sleepStages.rem   = Math.round(sleepStages.rem);

  // Main sleep session (longest by duration) — drives bedtime/wake/efficiency
  const sessions = googleData.sleep?.session ?? [];
  const mainSession = sessions.length
    ? sessions.reduce((a, b) =>
        (parseInt(b.endTimeMillis) - parseInt(b.startTimeMillis)) >
        (parseInt(a.endTimeMillis) - parseInt(a.startTimeMillis)) ? b : a
      )
    : null;
  const bedtime = mainSession ? new Date(parseInt(mainSession.startTimeMillis)).toISOString() : null;
  const wakeTime = mainSession ? new Date(parseInt(mainSession.endTimeMillis)).toISOString() : null;
  const inBedMinutes = mainSession
    ? Math.round((parseInt(mainSession.endTimeMillis) - parseInt(mainSession.startTimeMillis)) / 60000)
    : null;
  let efficiency = null;
  if (inBedMinutes && inBedMinutes > 0) {
    efficiency = Math.round((sleepStages.light + sleepStages.deep + sleepStages.rem) / inBedMinutes * 100);
    if (efficiency > 100) efficiency = 100;
    if (efficiency < 0) efficiency = 0;
  }

  return {
    profile: null,
    activity: {
      summary: {
        steps: stepsValue,
        distances: [{ distance: (distanceMeters / 1000).toFixed(2) }],
        caloriesOut: Math.round(caloriesValue),
        activeZoneMinutes: { totalMinutes: activeMinutes }
      },
      goals: {
        steps: 10000,
        distance: 8,
        caloriesOut: 2500,
        activeZoneMinutes: 30
      }
    },
    heartRate: [{ value: { restingHeartRate: restingHR, minBpm, avgBpm, maxBpm, heartRateZones }, intraday }],
    sleep: [],
    sleepSummary: {
      totalMinutesAsleep: sleepTotal,
      stages: sleepStages,
      bedtime,
      wakeTime,
      inBedMinutes,
      efficiency
    },
    nutrition: {
      food: { summary: { protein: 0, carbs: 0, fat: 0, calories: 0 } },
      water: { summary: { water: Math.round(waterMl) } }
    },
    body: null,
    devices: null
  };
}

// Historical data caching function
async function cacheHistoricalData() {
  try {
    // Get stored refresh token
    const userToken = await new Promise((resolve) => {
      db.get('SELECT refresh_token FROM user_tokens LIMIT 1', (err, row) => {
        resolve(row);
      });
    });

    if (!userToken || !userToken.refresh_token) {
      console.log('[CACHE] No stored refresh token found. Historical caching will run after first login.');
      return;
    }

    console.log('[CACHE] Starting historical data fetch (last 90 days)...');

    let accessToken;
    try {
      accessToken = await getValidToken(userToken.refresh_token, userToken.refresh_token);
    } catch (err) {
      console.warn('[CACHE] Token refresh failed, skipping historical cache');
      return;
    }

    const headers = { 'Authorization': `Bearer ${accessToken}` };
    const today = new Date();
    const daysAgo = 90;
    const promises = [];

    // Helper with exponential backoff for rate limit handling
    const aggregateWithRetry = async (dataTypeName, dateStr, bucketDurationMs = 86400000, maxRetries = 2) => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await axios.post(
            'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
            {
              aggregateBy: [{ dataTypeName }],
              bucketByTime: { durationMillis: bucketDurationMs },
              startTimeMillis: dayStart(dateStr),
              endTimeMillis: dayEnd(dateStr),
            },
            { headers, timeout: 10000 }
          );
          return response.data;
        } catch (err) {
          if (err.response?.status === 429 && attempt < maxRetries) {
            const backoffMs = 2000 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }
          return null;
        }
      }
    };

    // Sleep segments fetch (no bucketByTime — each segment is its own point)
    const fetchSleepSegmentsWithRetry = async (dateStr, maxRetries = 2) => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await axios.post(
            'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
            {
              aggregateBy: [{ dataTypeName: 'com.google.sleep.segment' }],
              startTimeMillis: dayStart(dateStr),
              endTimeMillis: dayEnd(dateStr),
            },
            { headers, timeout: 10000 }
          );
          return response.data;
        } catch (err) {
          if (err.response?.status === 429 && attempt < maxRetries) {
            const backoffMs = 2000 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }
          return null;
        }
      }
    };

    // Generate list of dates to cache (from January 1st to today)
    const currentYear = today.getFullYear();
    const yearStart = new Date(currentYear, 0, 1); // January 1st of current year
    const cacheDaysCount = Math.ceil((today - yearStart) / (1000 * 60 * 60 * 24)) + 1;
    for (let i = 1; i <= cacheDaysCount; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      // Check if already cached (skip if in health_data_cache)
      const cached = await new Promise((resolve) => {
        db.get(
          'SELECT date FROM health_data_cache WHERE date = ?',
          [dateStr],
          (err, row) => resolve(row)
        );
      });

      if (cached) {
        continue;
      }

      // Fetch data for this date (sequential, not parallel, to respect rate limits)
      try {
        const stepsData = await aggregateWithRetry('com.google.step_count.delta', dateStr);
        const heartData = await aggregateWithRetry('com.google.heart_rate.bpm', dateStr);
        const heartIntradayData = await aggregateWithRetry('com.google.heart_rate.bpm', dateStr, 900000);
        const weightData = await aggregateWithRetry('com.google.weight', dateStr);
        const caloriesData = await aggregateWithRetry('com.google.calories.expended', dateStr);
        const distanceData = await aggregateWithRetry('com.google.distance.delta', dateStr);
        const waterData = await aggregateWithRetry('com.google.hydration', dateStr);
        const sleepSegmentsData = await fetchSleepSegmentsWithRetry(dateStr);

        // Sleep data from sessions
        let sleepData = { session: [] };
        try {
          const sleepResponse = await axios.get(
            'https://www.googleapis.com/fitness/v1/users/me/sessions',
            {
              params: {
                startTime: Math.floor(dayStart(dateStr)),
                endTime: Math.floor(dayEnd(dateStr))
              },
              headers,
              timeout: 10000
            }
          );
          sleepData = sleepResponse.data;
        } catch (err) {
          // Silently fail for sleep data
        }

        const result = fitGoogleToFitbitShape({
          steps: stepsData,
          calories: caloriesData,
          distance: distanceData,
          activeMinutes: null,
          heart: heartData,
          weight: weightData,
          water: waterData,
          nutrition: null,
          sleep: sleepData,
          sleepSegments: sleepSegmentsData,
          heartIntraday: heartIntradayData
        });

        await CacheStore.setSnapshot(dateStr, result);

        const steps = result.activity?.summary?.steps || 0;
        const sleepMins = result.sleepSummary?.totalMinutesAsleep || 0;
        const hr = result.heartRate?.[0]?.value?.restingHeartRate || 0;
        const weight = result.body || 0;

        if (steps > 0 || sleepMins > 0 || hr > 0 || weight > 0) {
          await CacheStore.setDailySummary(dateStr, { steps, restingHr: hr, sleepMinutes: sleepMins, weight });
        }

        console.log(`[CACHE] Cached ${dateStr}`);

        // Longer delay between dates to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (err) {
        console.error(`[CACHE] Error fetching ${dateStr}:`, err.message);
      }
    }

    // Wait for remaining promises
    if (promises.length > 0) {
      await Promise.all(promises);
    }

    console.log('[CACHE] Historical data caching completed');
  } catch (err) {
    console.error('[CACHE] Historical caching failed:', err.message);
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  // Schema v2 migration: wipe cache once if shape changed, then backfill
  setTimeout(() => {
    db.get('SELECT value FROM cache_meta WHERE key = ?', ['health_data_schema'], (err, row) => {
      if (!row || row.value !== 'v2') {
        db.run('DELETE FROM health_data_cache', [], (delErr) => {
          if (delErr) {
            console.error('[CACHE] Migration failed:', delErr.message);
            return;
          }
          console.log('[CACHE] Schema v2 migration: cleared health_data_cache for rebuild');
          db.run(`INSERT OR REPLACE INTO cache_meta VALUES ('health_data_schema', 'v2')`);
          cacheHistoricalData().catch(err => console.error('[CACHE] Error:', err));
        });
      } else {
        cacheHistoricalData().catch(err => console.error('[CACHE] Error:', err));
      }
    });
  }, 2000);
});

module.exports = app;
