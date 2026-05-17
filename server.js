const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const axios = require('axios');
const { google } = require('googleapis');
const { dayStart, dayEnd, toRFC3339, getDatesInRange } = require('./dateHelpers');

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
const createGoogleFitGateway = require('./lib/googleFitGateway');
const GoogleFitGateway = createGoogleFitGateway(axios);

// Activity history endpoint (charts: day/week/month views)
app.get('/api/activity-history', async (req, res) => {
  const authHeader = req.headers.authorization?.split(' ')[1];
  const refreshToken = req.query.refresh;
  const { date, range, type = 'steps' } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  try {
    let accessToken = authHeader;
    if (refreshToken) {
      try { accessToken = await getValidToken(authHeader, refreshToken); }
      catch { /* use provided token */ }
    }
    const result = await MetricHistory.getRange(type, targetDate, range, accessToken);
    res.json(result);
  } catch (error) {
    console.error('[ActivityHistory] Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch activity history' });
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

    const result = await GoogleFitGateway.fetchDay(accessToken, today);

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

    const today = new Date();
    const daysAgo = 90;
    const promises = [];

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
        const result = await GoogleFitGateway.fetchDay(accessToken, dateStr);

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
