const { getDatesInRange } = require('./dateHelpers');

const TYPE_CONFIG = {
  steps:  { column: 'steps',         dataType: 'com.google.step_count.delta' },
  heart:  { column: 'resting_hr',    dataType: 'com.google.heart_rate.bpm' },
  sleep:  { column: 'sleep_minutes', dataType: 'com.google.sleep.segment' },
  weight: { column: 'weight',        dataType: 'com.google.weight' },
};

module.exports = function createMetricHistory(CacheStore, GoogleFitGateway, axios) {
  return {
    async getRange(type, date, range, accessToken) {
      const config = TYPE_CONFIG[type] || TYPE_CONFIG.steps;
      const today = new Date().toISOString().split('T')[0];
      const isToday = date === today;

      console.log(`[MetricHistory] getRange: type=${type} range=${range} date=${date}`);

      // --- DAY VIEW: steps ---
      if (range === 'day' && type === 'steps') {
        if (!isToday) {
          const cached = await CacheStore.getIntraday(date);
          if (cached) {
            console.log(`[MetricHistory] CACHE HIT: Intraday steps for ${date}`);
            return cached;
          }
        }
        try {
          const result = await GoogleFitGateway.fetchIntraday(accessToken, date, 'steps');
          if (!isToday) await CacheStore.setIntraday(date, result);
          return result;
        } catch (err) {
          console.error('[MetricHistory] fetchIntraday error:', err.message);
          return [];
        }
      }

      // --- DAY VIEW: heart ---
      if (range === 'day' && type === 'heart') {
        const snapshot = await CacheStore.getSnapshot(date);
        if (snapshot) {
          const intraday = snapshot.heartRate?.[0]?.intraday ?? [];
          if (intraday.length > 0) {
            return intraday.map(p => ({ label: p.time, value: p.value }));
          }
        }
        // Fallback: fetch 15-min HR buckets directly
        try {
          const headers = { Authorization: `Bearer ${accessToken}` };
          const { dayStart, dayEnd } = require('./dateHelpers');
          const resp = await axios.post(
            'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
            {
              aggregateBy: [{ dataTypeName: 'com.google.heart_rate.bpm' }],
              bucketByTime: { durationMillis: 900000 },
              startTimeMillis: dayStart(date),
              endTimeMillis: dayEnd(date),
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
          return points;
        } catch (_) {
          return [];
        }
      }

      // --- WEEK / MONTH VIEW ---
      const daysCount = range === 'week' ? 7 : 30;
      const startDateObj = new Date(date + 'T00:00:00');
      startDateObj.setDate(startDateObj.getDate() - (daysCount - 1));
      const startDate = startDateObj.toISOString().split('T')[0];
      const dateList = getDatesInRange(startDate, date);

      const cacheMap = await CacheStore.getDailySummary(dateList, config.column);

      const missingDates = dateList.filter(d => {
        if (d === today) return true; // always refresh today
        return cacheMap.get(d) == null;
      });

      if (missingDates.length === 0 && !isToday) {
        console.log(`[MetricHistory] CACHE HIT: ${range} ${type} for ${date}`);
        return dateList.map(d => ({ label: d, date: d, value: cacheMap.get(d) || 0 }));
      }

      console.log(`[MetricHistory] API FETCH: ${type} for ${missingDates.length} missing dates`);

      const fetchedMap = new Map();
      try {
        const datesToFetch = missingDates.length > 0 ? missingDates : dateList;
        const fetched = await GoogleFitGateway.fetchAggregate(accessToken, datesToFetch, config.dataType);

        for (const { date: d, value } of fetched) {
          fetchedMap.set(d, value);
          const values =
            type === 'steps'  ? { steps: value } :
            type === 'heart'  ? { restingHr: value } :
            type === 'sleep'  ? { sleepMinutes: value } :
                                { weight: value };
          await CacheStore.setDailySummary(d, values);
        }
      } catch (err) {
        if (err.response?.status === 429) {
          console.warn(`[MetricHistory] Rate limited (429), returning cached data for ${type}`);
          return dateList.map(d => ({ label: d, date: d, value: cacheMap.get(d) || 0 }));
        }
        throw err;
      }

      console.log(`[MetricHistory] API SUCCESS: ${fetchedMap.size} points fetched`);

      return dateList.map(d => ({
        label: d,
        date: d,
        value: fetchedMap.has(d) ? fetchedMap.get(d) : (cacheMap.get(d) || 0),
      }));
    },
  };
};
