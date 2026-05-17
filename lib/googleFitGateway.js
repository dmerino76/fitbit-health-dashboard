module.exports = function createGoogleFitGateway(axios) {
  const { dayStart, dayEnd, toRFC3339, getDatesInRange } = require('./dateHelpers');
  return {
    async fetchDay(token, date) {
      const headers = { Authorization: 'Bearer ' + token };

      const aggregate = async (dataTypeName, durationMillis = 86400000) => {
        for (let attempt = 0; attempt <= 2; attempt++) {
          try {
            const response = await axios.post(
              'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
              {
                aggregateBy: [{ dataTypeName }],
                bucketByTime: { durationMillis },
                startTimeMillis: dayStart(date),
                endTimeMillis: dayEnd(date),
              },
              { headers }
            );
            return response.data;
          } catch (err) {
            if (err.response?.status === 429 && attempt < 2) {
              await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
              continue;
            }
            console.error(`[API-ERROR] Aggregate failed for ${dataTypeName}:`, err.response?.data || err.message);
            return null;
          }
        }
      };

      const aggregateIntraday = (dataTypeName) => aggregate(dataTypeName, 900000);

      const [
        stepsData,
        caloriesData,
        distanceData,
        activeMinutesData,
        heartData,
        weightData,
        waterData,
        nutritionData,
        heartIntradayData,
      ] = await Promise.all([
        aggregate('com.google.step_count.delta'),
        aggregate('com.google.calories.expended'),
        aggregate('com.google.distance.delta'),
        aggregate('com.google.active_minutes'),
        aggregate('com.google.heart_rate.bpm'),
        aggregate('com.google.weight'),
        aggregate('com.google.hydration'),
        aggregate('com.google.nutrition'),
        aggregateIntraday('com.google.heart_rate.bpm'),
      ]);

      let sleepData = { session: [] };
      try {
        const sleepResponse = await axios.get(
          'https://www.googleapis.com/fitness/v1/users/me/sessions',
          {
            params: {
              startTime: toRFC3339(dayStart(date)),
              endTime: toRFC3339(dayEnd(date)),
            },
            headers,
          }
        );
        sleepData = sleepResponse.data;
      } catch (err) {
        console.warn('[API-WARN] Sleep data unavailable:', err.response?.data?.error?.message || err.message);
      }

      const sleepSegmentsResp = await axios.post(
        'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
        {
          aggregateBy: [{ dataTypeName: 'com.google.sleep.segment' }],
          startTimeMillis: dayStart(date),
          endTimeMillis: dayEnd(date),
        },
        { headers }
      ).catch(() => null);

      return buildSnapshot({
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
        heartIntraday: heartIntradayData,
      });
    },

    async fetchAggregate(token, dates, dataType) {
      const headers = { Authorization: 'Bearer ' + token };

      // Handle empty dates array
      if (!dates || dates.length === 0) {
        return [];
      }

      const startTimeMillis = dayStart(dates[0]);
      const endTimeMillis = dayEnd(dates[dates.length - 1]);

      try {
        const response = await axios.post(
          'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
          {
            aggregateBy: [{ dataTypeName: dataType }],
            bucketByTime: { durationMillis: 86400000 }, // 1 day buckets
            startTimeMillis,
            endTimeMillis,
          },
          { headers }
        );

        const buckets = response.data.bucket || [];
        const result = [];

        buckets.forEach(bucket => {
          const dataset = bucket.dataset?.[0];
          if (!dataset || !dataset.point || dataset.point.length === 0) return;

          const point = dataset.point[0];
          const value = point.value?.[0]?.fpVal || point.value?.[0]?.intVal;
          if (value === undefined) return;

          const date = new Date(parseInt(bucket.startTimeMillis)).toISOString().split('T')[0];
          result.push({ date, value: Math.round(value) });
        });

        return result;
      } catch (err) {
        if (err.response?.status === 429) {
          console.warn(`[API-ERROR] Rate limited for fetchAggregate: ${dataType}`);
          return [];
        }
        console.error(`[API-ERROR] fetchAggregate failed for ${dataType}:`, err.response?.data || err.message);
        return [];
      }
    },

    async fetchIntraday(token, date, type) {
      const headers = { Authorization: 'Bearer ' + token };

      // Handle steps: fetch daily aggregate (single bucket)
      if (type === 'steps') {
        try {
          const response = await axios.post(
            'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
            {
              aggregateBy: [{ dataTypeName: 'com.google.step_count.delta' }],
              bucketByTime: { durationMillis: 86400000 }, // 1 day bucket
              startTimeMillis: dayStart(date),
              endTimeMillis: dayEnd(date),
            },
            { headers }
          );

          const bucket = response.data.bucket?.[0];
          if (!bucket) return [{ label: 'Total', value: 0 }];

          const dataset = bucket.dataset?.[0];
          if (!dataset || !dataset.point || dataset.point.length === 0) {
            return [{ label: 'Total', value: 0 }];
          }

          const point = dataset.point[0];
          const value = point.value?.[0]?.intVal || 0;
          return [{ label: 'Total', value: Math.round(value) }];
        } catch (err) {
          if (err.response?.status === 429) {
            console.warn(`[API-ERROR] Rate limited for steps intraday`);
            return [{ label: 'Total', value: 0 }];
          }
          console.error(`[API-ERROR] fetchIntraday failed for steps:`, err.response?.data || err.message);
          return [{ label: 'Total', value: 0 }];
        }
      }

      // Handle heart rate: fetch 15-min intraday HR buckets
      if (type === 'heart') {
        try {
          const response = await axios.post(
            'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
            {
              aggregateBy: [{ dataTypeName: 'com.google.heart_rate.bpm' }],
              bucketByTime: { durationMillis: 900000 }, // 15 minutes
              startTimeMillis: dayStart(date),
              endTimeMillis: dayEnd(date),
            },
            { headers }
          );

          const points = [];
          const buckets = response.data.bucket || [];

          buckets.forEach(bucket => {
            const dataset = bucket.dataset?.[0];
            if (!dataset || !dataset.point || dataset.point.length === 0) return;

            const point = dataset.point[0];
            const bpmVal = point.value?.[0]?.fpVal;
            if (!bpmVal) return;

            const d = new Date(parseInt(bucket.startTimeMillis));
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            points.push({ label: `${hh}:${mm}`, value: Math.round(bpmVal) });
          });

          return points;
        } catch (err) {
          if (err.response?.status === 429) {
            console.warn(`[API-ERROR] Rate limited for heart intraday`);
            return [];
          }
          console.error(`[API-ERROR] fetchIntraday failed for heart:`, err.response?.data || err.message);
          return [];
        }
      }

      // Default fallback
      return [];
    },
  };
};

function buildSnapshot(googleData) {
  const extractValue = (data, index = 0) => {
    if (!data || !data.bucket || !data.bucket[index] || !data.bucket[index].dataset || !data.bucket[index].dataset[0]) {
      return null;
    }
    const points = data.bucket[index].dataset[0].point;
    if (!points || points.length === 0) return null;
    return points[0].value;
  };

  const stepsValue = extractValue(googleData.steps)?.[0]?.intVal || 0;
  const caloriesValue = extractValue(googleData.calories)?.[0]?.fpVal || 0;
  const distanceMeters = extractValue(googleData.distance)?.[0]?.fpVal || 0;
  const activeMinutes = extractValue(googleData.activeMinutes)?.[0]?.intVal || 0;
  const heartAllValues = extractValue(googleData.heart) || [];
  const weightValue = extractValue(googleData.weight)?.[0]?.fpVal || 0;
  const waterMl = extractValue(googleData.water)?.[0]?.fpVal || 0;

  const maxHR = 190;
  const heartRateZones = [
    { name: 'Out of Zone', min: 0,                   max: Math.round(maxHR * 0.5),  minutes: 0, color: '#6b7280' },
    { name: 'Fat Burn',    min: Math.round(maxHR * 0.5),  max: Math.round(maxHR * 0.7),  minutes: 0, color: '#0ea5e9' },
    { name: 'Cardio',      min: Math.round(maxHR * 0.7),  max: Math.round(maxHR * 0.85), minutes: 0, color: '#f97316' },
    { name: 'Peak',        min: Math.round(maxHR * 0.85), max: maxHR,                    minutes: 0, color: '#ef4444' },
  ];

  const intraday = [];
  if (googleData.heartIntraday && googleData.heartIntraday.bucket) {
    googleData.heartIntraday.bucket.forEach(bucket => {
      const dataset = bucket.dataset?.[0];
      if (!dataset || !dataset.point || dataset.point.length === 0) return;
      const point = dataset.point[0];
      const bpmVal = point.value?.[0]?.fpVal;
      if (!bpmVal) return;

      const d = new Date(parseInt(bucket.startTimeMillis));
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      intraday.push({ time: `${hh}:${mm}`, value: Math.round(bpmVal) });

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

  const intradayValues = intraday.map(p => p.value);
  const minBpm = intradayValues.length ? Math.min(...intradayValues) : 0;
  const maxBpm = intradayValues.length ? Math.max(...intradayValues) : 0;
  const avgBpm = intradayValues.length
    ? Math.round(intradayValues.reduce((s, v) => s + v, 0) / intradayValues.length)
    : (heartAllValues[0]?.fpVal ? Math.round(heartAllValues[0].fpVal) : 0);
  const restingHR = minBpm || avgBpm || 0;

  let sleepTotal = 0;
  let sleepStages = { deep: 0, rem: 0, light: 0, wake: 0 };

  if (googleData.sleep && googleData.sleep.session) {
    googleData.sleep.session.forEach(session => {
      if (session.activityType === 72) {
        sleepTotal += Math.round((parseInt(session.endTimeMillis) - parseInt(session.startTimeMillis)) / 60000);
      }
    });
  }

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
    }
  });

  sleepStages.wake  = Math.round(sleepStages.wake);
  sleepStages.light = Math.round(sleepStages.light);
  sleepStages.deep  = Math.round(sleepStages.deep);
  sleepStages.rem   = Math.round(sleepStages.rem);

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
        activeZoneMinutes: { totalMinutes: activeMinutes },
      },
      goals: {
        steps: 10000,
        distance: 8,
        caloriesOut: 2500,
        activeZoneMinutes: 30,
      },
    },
    heartRate: [{ value: { restingHeartRate: restingHR, minBpm, avgBpm, maxBpm, heartRateZones }, intraday }],
    sleep: [],
    sleepSummary: {
      totalMinutesAsleep: sleepTotal,
      stages: sleepStages,
      bedtime,
      wakeTime,
      inBedMinutes,
      efficiency,
    },
    nutrition: {
      food: { summary: { protein: 0, carbs: 0, fat: 0, calories: 0 } },
      water: { summary: { water: Math.round(waterMl) } },
    },
    body: null,
    devices: null,
  };
}
