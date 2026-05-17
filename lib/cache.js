module.exports = function createCacheStore(db) {
  return {
    getSnapshot(date) {
      return new Promise((resolve, reject) => {
        db.get('SELECT data FROM health_data_cache WHERE date = ?', [date], (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(null);
          try {
            resolve(JSON.parse(row.data));
          } catch {
            resolve(null);
          }
        });
      });
    },

    setSnapshot(date, snapshot) {
      const sleep = snapshot.sleepSummary?.totalMinutesAsleep ?? 0;
      const avgBpm = snapshot.heartRate?.[0]?.value?.avgBpm ?? 0;
      if (sleep <= 0) {
        console.warn(`[CACHE] setSnapshot skipped for ${date}: zero/missing sleep`);
        return Promise.resolve();
      }
      if (avgBpm <= 0) {
        console.warn(`[CACHE] setSnapshot skipped for ${date}: zero/missing HR`);
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        db.run(
          'INSERT OR REPLACE INTO health_data_cache (date, data, created_at) VALUES (?, ?, ?)',
          [date, JSON.stringify(snapshot), Math.floor(Date.now() / 1000)],
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
      });
    },

    getDailySummary(dates, column) {
      if (!dates.length) return Promise.resolve(new Map());
      const placeholders = dates.map(() => '?').join(',');
      return new Promise((resolve, reject) => {
        db.all(
          `SELECT date, ${column} as val FROM daily_summary WHERE date IN (${placeholders})`,
          dates,
          (err, rows) => {
            if (err) return reject(err);
            const map = new Map();
            for (const row of rows) map.set(row.date, row.val);
            resolve(map);
          }
        );
      });
    },

    setDailySummary(date, values) {
      const { steps, restingHr, sleepMinutes, weight } = values;
      return new Promise((resolve, reject) => {
        db.run('INSERT OR IGNORE INTO daily_summary (date) VALUES (?)', [date], (err) => {
          if (err) return reject(err);
          db.run(
            'UPDATE daily_summary SET steps = ?, sleep_minutes = ?, resting_hr = ?, weight = ? WHERE date = ?',
            [steps || 0, sleepMinutes || null, restingHr || 0, weight || 0, date],
            (err2) => {
              if (err2) return reject(err2);
              resolve();
            }
          );
        });
      });
    },

    getIntraday(date) {
      return new Promise((resolve, reject) => {
        db.get('SELECT json_data FROM intraday_json WHERE date = ?', [date], (err, row) => {
          if (err) return reject(err);
          if (!row) return resolve(null);
          try {
            resolve(JSON.parse(row.json_data));
          } catch {
            resolve(null);
          }
        });
      });
    },

    setIntraday(date, json) {
      return new Promise((resolve, reject) => {
        db.run(
          'INSERT OR REPLACE INTO intraday_json (date, json_data) VALUES (?, ?)',
          [date, JSON.stringify(json)],
          (err) => {
            if (err) return reject(err);
            resolve();
          }
        );
      });
    },
  };
};
