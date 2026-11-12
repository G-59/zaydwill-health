import fs from 'fs';
import path from 'path';
import { format, subDays } from 'date-fns';
import type {
  DailyMetrics, SleepData, HRVData, BodyBatteryData,
  StressData, ActivityData, WeeklyTrend, TrendPoint, StepSample, DemoReason, ScaleReading,
} from './types';
import {
  calculateSleepScore, calculateRecoveryScore, getRecoveryCategory,
  calculateStrainScore, calculateDailyStrain, getHRVStatus,
} from './scoring';
import { mockData } from './mockData';

// ─── In-memory cache ──────────────────────────────────────────────────────────
interface CacheEntry { data: DailyMetrics; ts: number }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 15 * 60 * 1000; // 15 min

// ─── Singleton Garmin client ──────────────────────────────────────────────────
let garminClient: unknown = null;
let clientTs = 0;
let loginInFlight: Promise<unknown> | null = null;
const CLIENT_TTL = 55 * 60 * 1000; // 55 min

const AUTH_FILE = path.join(process.cwd(), '.garmin-auth.json');
const LOCK_FILE = path.join(process.cwd(), '.garmin-login.lock');

interface AuthState {
  oauth1?: unknown;
  oauth2?: unknown;
  blockedUntil?: number;
  failures?: number;
  reason?: 'rate_limited' | 'login_failed';
}

function readAuth(): AuthState {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as AuthState;
  } catch {
    return {};
  }
}

function writeAuth(state: AuthState) {
  try {
    fs.writeFileSync(AUTH_FILE, JSON.stringify(state));
  } catch (err) {
    console.warn('[Garmin] could not save session state');
  }
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function acquireLoginLock(): boolean {
  try {
    const stat = fs.statSync(LOCK_FILE);
    if (Date.now() - stat.mtimeMs < 45_000) return false;
    fs.unlinkSync(LOCK_FILE);
  } catch { /* no lock yet */ }
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function releaseLoginLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ }
}

function rememberClient(client: { loadToken: (a: unknown, b: unknown) => void }, oauth1: unknown, oauth2: unknown) {
  client.loadToken(oauth1, oauth2);
  garminClient = client;
  clientTs = Date.now();
}

function loginFailure(err: unknown, previous: AuthState): AuthState {
  const msg = err instanceof Error ? err.message : String(err);
  const rateLimited = /429|1015|rate_limited|Too Many Requests/i.test(msg);
  const failures = (previous.failures ?? 0) + 1;
  const hinted = Number(msg.match(/"retry_after":\s*(\d+)/)?.[1] ?? 0) * 1000;
  const exponential = Math.min(15 * 60 * 1000, 30_000 * 2 ** Math.min(failures - 1, 5));
  const wait = rateLimited ? Math.max(hinted || 30_000, exponential) : 60_000;
  console.error(
    `[Garmin] login failed (${rateLimited ? 'rate limited by Garmin' : 'rejected'}). Next attempt in ${Math.ceil(wait / 1000)}s`,
  );
  return {
    oauth1: previous.oauth1,
    oauth2: previous.oauth2,
    blockedUntil: Date.now() + wait,
    failures,
    reason: rateLimited ? 'rate_limited' : 'login_failed',
  };
}

function demoReasonForMissingClient(hasCredentials: boolean): DemoReason {
  if (!hasCredentials) return 'no_credentials';
  const saved = readAuth();
  if (saved.reason === 'rate_limited' && (saved.blockedUntil ?? 0) > Date.now()) return 'rate_limited';
  return 'login_failed';
}

async function getClient(): Promise<unknown> {
  if (garminClient && Date.now() - clientTs < CLIENT_TTL) return garminClient;
  if (loginInFlight) return loginInFlight;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GarminConnect } = require('garmin-connect');

  const hasPassword = !!(process.env.GARMIN_USERNAME && process.env.GARMIN_PASSWORD);
  const envOauth1 = parseJson(process.env.GARMIN_OAUTH1);
  const envOauth2 = parseJson(process.env.GARMIN_OAUTH2);
  if (!hasPassword && !(envOauth1 && envOauth2)) return null;

  const saved = readAuth();
  const oauth1 = envOauth1 || saved.oauth1;
  const oauth2 = envOauth2 || saved.oauth2;

  const client = new GarminConnect({
    username: process.env.GARMIN_USERNAME,
    password: process.env.GARMIN_PASSWORD,
  }) as { loadToken: (a: unknown, b: unknown) => void; login: () => Promise<unknown>; exportToken: () => { oauth1: unknown; oauth2: unknown } };

  if (oauth1 && oauth2) {
    try {
      rememberClient(client, oauth1, oauth2);
      console.log('[Garmin] session restored');
      return client;
    } catch {
      console.warn('[Garmin] saved session could not be restored');
    }
  }

  if ((saved.blockedUntil ?? 0) > Date.now()) {
    const secs = Math.ceil(((saved.blockedUntil ?? 0) - Date.now()) / 1000);
    console.warn(`[Garmin] sign-in paused for ${secs}s`);
    return null;
  }

  loginInFlight = (async () => {
    const locked = acquireLoginLock();
    if (!locked) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      const later = readAuth();
      if (later.oauth1 && later.oauth2) {
        rememberClient(client, later.oauth1, later.oauth2);
        console.log('[Garmin] session restored');
        return client;
      }
      return null;
    }

    try {
      await client.login();
      let tokens: { oauth1?: unknown; oauth2?: unknown } = {};
      try { tokens = client.exportToken(); } catch { /* session works even if export fails */ }
      writeAuth({
        oauth1: tokens.oauth1,
        oauth2: tokens.oauth2,
        blockedUntil: 0,
        failures: 0,
      });
      garminClient = client;
      clientTs = Date.now();
      console.log('[Garmin] login successful');
      return client;
    } catch (err) {
      writeAuth(loginFailure(err, saved));
      garminClient = null;
      return null;
    } finally {
      releaseLoginLock();
    }
  })();

  try {
    return await loginInFlight;
  } finally {
    loginInFlight = null;
  }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parseSleep(raw: Record<string, unknown>): SleepData {
  const dto = (raw?.dailySleepDTO ?? raw ?? {}) as Record<string, unknown>;
  const total = (dto.sleepTimeSeconds ?? dto.totalSleepSeconds ?? 0) as number;
  return {
    totalSleepSeconds: total,
    deepSleepSeconds: (dto.deepSleepSeconds ?? 0) as number,
    remSleepSeconds: (dto.remSleepSeconds ?? 0) as number,
    lightSleepSeconds: (dto.lightSleepSeconds ?? 0) as number,
    awakeSleepSeconds: (dto.awakeSleepSeconds ?? 0) as number,
    sleepScore: ((dto.sleepScores as Record<string, unknown> | undefined)?.overall as Record<string, unknown> | undefined)?.value as number ?? (dto.sleepScore as number) ?? 0,
    averageSpO2: (dto.averageSpO2Value ?? dto.averageSpO2 ?? 0) as number,
    averageHRV: (dto.averageHrvValue ?? dto.averageHRV ?? 0) as number,
    averageRespiration: (dto.averageRespirationValue ?? dto.averageRespiration ?? 0) as number,
    startTime: (dto.sleepStartTimestampLocal ?? dto.startTime ?? '') as string,
    endTime: (dto.sleepEndTimestampLocal ?? dto.endTime ?? '') as string,
  };
}

function parseHRV(raw: Record<string, unknown>, trend: number[], sleepHRVFallback = 0): HRVData {
  const s = (raw?.hrvSummary ?? raw ?? {}) as Record<string, unknown>;
  const weekly = (s.weeklyAvg ?? s.weeklyAverage ?? 0) as number;
  // Some devices only expose HRV via the sleep endpoint — use it when the dedicated endpoint has no data
  const last = ((s.lastNight ?? s.lastNightAvg ?? 0) as number) || sleepHRVFallback;
  const weeklyFinal = weekly || (sleepHRVFallback > 0 ? sleepHRVFallback : 0);
  return {
    weeklyAverage: weeklyFinal,
    lastNight: last,
    status: getHRVStatus(last, weeklyFinal),
    trend,
  };
}

function batteryClock(value: unknown): string | null {
  const date = parseGarminTime(value);
  if (!date) return null;
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Event objects, report rows, or [timestamp, level] / [timestamp, event, level] tuples. */
function collectBatteryReadings(raw: unknown): Array<{ time: string; value: number }> {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const points: Array<{ time: string; value: number }> = [];

  const pushTuple = (entry: unknown[]) => {
    const time = batteryClock(entry[0]);
    const level = Number(entry.length >= 3 ? entry[2] : entry[1]);
    if (!time || !Number.isFinite(level) || level < 0 || level > 100) return;
    points.push({ time, value: level });
  };

  for (const row of rows) {
    if (Array.isArray(row)) {
      pushTuple(row);
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    if (Array.isArray(rec.bodyBatteryValuesArray)) {
      for (const entry of rec.bodyBatteryValuesArray) {
        if (Array.isArray(entry)) pushTuple(entry);
      }
      continue;
    }
    const time = batteryClock(rec.startTimestampLocal ?? rec.startTimestampGMT ?? rec.timestamp);
    const level = Number(rec.dynamicFeedbackScore ?? rec.bodyBatteryScore ?? rec.bodyBatteryValue ?? rec.level);
    if (time && Number.isFinite(level) && level >= 0 && level <= 100) points.push({ time, value: level });
  }

  return points;
}

function parseBodyBattery(raw: unknown, summary?: Record<string, unknown> | null): BodyBatteryData {
  const readings = collectBatteryReadings(raw);
  const report = Array.isArray(raw) ? raw.find(row => row && typeof row === 'object' && !Array.isArray(row)) as Record<string, unknown> | undefined : null;

  if (readings.length === 0) {
    const current = (summary?.bodyBatteryMostRecentValue ?? 0) as number;
    const high = (summary?.bodyBatteryHighestValue ?? summary?.bodyBatteryAtWakeTime ?? 0) as number;
    if (current > 0 || high > 0) {
      const consumed = high > current ? high - current : 0;
      return { isAvailable: true, current, charged: high, drained: consumed, data: [] };
    }
    return { isAvailable: false, current: 0, charged: 0, drained: 0, data: [] };
  }

  const currentVal = readings[readings.length - 1].value;
  const summaryCurrent = Number(summary?.bodyBatteryMostRecentValue);
  const summaryHigh = Number(summary?.bodyBatteryHighestValue ?? summary?.bodyBatteryAtWakeTime ?? 0);
  const current = summaryCurrent > 0 ? summaryCurrent : currentVal;
  const charged = summaryHigh > 0
    ? summaryHigh
    : Number(report?.charged) || Math.max(...readings.map(reading => reading.value));
  const drained = summaryHigh > current
    ? summaryHigh - current
    : Number(report?.drained) || Math.max(0, charged - current);
  return {
    isAvailable: true,
    current,
    charged,
    drained,
    data: readings,
  };
}

function parseStress(raw: Record<string, unknown>): StressData {
  const arr = (raw?.stressValuesArray ?? []) as [number, number][];
  const valid = arr.filter(([, v]) => v >= 0).map(([ts, v]) => ({
    time: new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    value: v,
  }));
  const avg = valid.length ? valid.reduce((s, v) => s + v.value, 0) / valid.length : 30;
  const highCount = valid.filter(v => v.value > 50).length;
  const restingCount = arr.filter(([, v]) => v === -1).length;
  return {
    average: Math.round(avg),
    data: valid,
    highStressPercentage: valid.length ? Math.round((highCount / valid.length) * 100) : 0,
    restingPercentage: arr.length ? Math.round((restingCount / arr.length) * 100) : 0,
  };
}

function parseGarminTime(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  if (typeof value !== 'string' || !value) return null;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
  const iso = hasZone ? value : `${value.replace(/\.\d+$/, '')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hourLabel(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric' });
}

function clockLabel(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Garmin's daily chart is ~15-minute samples. Roll them into one bar per hour. */
function parseStepsTimeline(raw: unknown): StepSample[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((Object.values(raw as Record<string, unknown>).find(Array.isArray) as unknown[] | undefined) ?? [])
      : [];

  const buckets = new Map<number, number>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const steps = Number(rec.steps ?? rec.stepCount ?? 0);
    if (!Number.isFinite(steps) || steps < 0) continue;
    const start = parseGarminTime(
      rec.startGMT ?? rec.startTimestampGMT ?? rec.startTimestampLocal ?? rec.startTime,
    );
    if (!start) continue;
    const hour = new Date(start);
    hour.setMinutes(0, 0, 0);
    const key = hour.getTime();
    buckets.set(key, (buckets.get(key) ?? 0) + steps);
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  if (keys.length >= 2) {
    for (let t = keys[0]; t <= keys[keys.length - 1]; t += 60 * 60 * 1000) {
      if (!buckets.has(t)) buckets.set(t, 0);
    }
  }

  let total = 0;
  return [...buckets.keys()].sort((a, b) => a - b).map(ms => {
    const steps = buckets.get(ms) ?? 0;
    total += steps;
    const start = new Date(ms);
    const end = new Date(ms + 60 * 60 * 1000);
    return {
      time: hourLabel(start),
      period: `${clockLabel(start)} – ${clockLabel(end)}`,
      steps,
      total,
    };
  });
}

function parseActivities(raw: unknown[]): ActivityData[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 5).map((a: unknown) => {
    const act = a as Record<string, unknown>;
    const avgHR = (act.averageHR ?? act.averageHeartRateInBeatsPerMinute ?? 0) as number;
    const maxHR = (act.maxHR ?? act.maxHeartRateInBeatsPerMinute ?? 0) as number;
    const dur = (act.duration ?? act.movingDuration ?? 0) as number;
    const type = act.activityType as Record<string, unknown> | undefined;
    return {
      name: (act.activityName ?? act.name ?? 'Activity') as string,
      duration: dur,
      calories: (act.calories ?? 0) as number,
      strain: 0,
      averageHR: avgHR,
      maxHR,
      type: (type?.typeKey ?? type?.key ?? 'other') as string,
    };
  });
}

// ─── Main fetch ───────────────────────────────────────────────────────────────
export async function fetchDailyMetrics(dateStr?: string): Promise<DailyMetrics> {
  const date = dateStr ?? format(new Date(), 'yyyy-MM-dd');

  const cached = cache.get(date);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const hasCredentials = !!(process.env.GARMIN_USERNAME && process.env.GARMIN_PASSWORD)
    || !!(process.env.GARMIN_OAUTH1 && process.env.GARMIN_OAUTH2);

  const client = await getClient();
  if (!client) {
    return {
      ...mockData,
      date,
      isDemo: true,
      demoReason: demoReasonForMissingClient(hasCredentials),
    };
  }

  try {
    const gc = client as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const today = new Date(date);
    const GC_API = 'https://connectapi.garmin.com';

    // Get displayName first — needed for the usersummary endpoint
    let displayName = '';
    try {
      const profile = await gc.getUserProfile() as Record<string, unknown>;
      displayName = (profile.displayName ?? '') as string;
    } catch { /* ignore — usersummary will just fail silently */ }

    // Parallel fetch — silence individual failures with allSettled
    // Note: getSleepData/getHeartRate expect Date objects; HRV/battery/stress
    // are not in garmin-connect@1.6.2 so we call the raw endpoints via gc.get()
    const [sleepRes, hrvRes, hrRes, bbReportRes, stressRes, actsRes, stepsRes, summaryRes, stepsChartRes] = await Promise.allSettled([
      gc.getSleepData(today),
      gc.get(`${GC_API}/hrv-service/hrv/${date}`),
      gc.getHeartRate(today),
      // Samples through the day. A date in the path 404s; Garmin wants query params.
      gc.get(`${GC_API}/wellness-service/wellness/bodyBattery/reports/daily?startDate=${date}&endDate=${date}`),
      gc.get(`${GC_API}/wellness-service/wellness/dailyStress/${date}`),
      gc.getActivities(0, 5),
      gc.getSteps(today),
      // Daily summary — reliable fallback for BB aggregates
      displayName
        ? gc.get(`${GC_API}/usersummary-service/usersummary/daily/${displayName}?calendarDate=${date}`)
        : Promise.resolve(null),
      // 15-minute step samples. Date belongs in the query; a date in the path is rejected.
      displayName
        ? gc.get(`${GC_API}/wellness-service/wellness/dailySummaryChart/${displayName}?date=${date}`)
        : gc.get(`${GC_API}/wellness-service/wellness/dailySummaryChart?date=${date}`),
    ]);

    // HRV 7-day trend — derive from weeklyAvg + lastNight (avoids 7 extra API calls)
    // Will be enriched later once we have access to historical endpoint
    const buildHrvTrend = (weeklyAvg: number, lastNight: number): number[] => {
      if (!weeklyAvg) return Array(7).fill(0);
      // Seed deterministic variation from weeklyAvg so it's stable across renders
      const seed = Math.round(weeklyAvg);
      const offsets = [0, 3, -2, 5, -4, 2, 0];
      return offsets.map((o, i) => (i === 6 ? lastNight || weeklyAvg : Math.max(1, weeklyAvg + o + (seed % (i + 2)) - 1)));
    };
    // Parse today's HRV early to build the trend
    // Guard: API returns "" (empty string) when device hasn't synced yet — treat as {}
    const todayHrvRaw = (
      hrvRes.status === 'fulfilled' &&
      typeof hrvRes.value === 'object' &&
      hrvRes.value !== null
        ? hrvRes.value
        : {}
    ) as Record<string, unknown>;
    const todayHrvSummary = (todayHrvRaw?.hrvSummary ?? todayHrvRaw) as Record<string, unknown>;
    const weeklyAvgEarly = (todayHrvSummary?.weeklyAvg ?? todayHrvSummary?.weeklyAverage ?? 0) as number;
    const lastNightEarly = (todayHrvSummary?.lastNight ?? todayHrvSummary?.lastNightAvg ?? 0) as number;
    const hrvTrend = buildHrvTrend(weeklyAvgEarly, lastNightEarly);

    const sleep = parseSleep(sleepRes.status === 'fulfilled' ? sleepRes.value as Record<string, unknown> : {});
    // Prefer Garmin's native sleep score (parseSleep extracts sleepScores.overall.value).
    // Fall back to our custom duration+quality algo only when Garmin returns 0.
    const sleepScore = sleep.sleepScore > 0 ? sleep.sleepScore : calculateSleepScore(sleep);
    sleep.sleepScore = sleepScore;

    // If the dedicated HRV endpoint returned nothing, rebuild the trend from sleep's averageHRV
    const effectiveHrvTrend = weeklyAvgEarly > 0
      ? hrvTrend
      : buildHrvTrend(sleep.averageHRV, sleep.averageHRV);

    const hrv = parseHRV(
      hrvRes.status === 'fulfilled' &&
      typeof hrvRes.value === 'object' &&
      hrvRes.value !== null
        ? hrvRes.value as Record<string, unknown>
        : {},
      effectiveHrvTrend,
      sleep.averageHRV,
    );

    // Daily summary — parse first so it can be used as fallback for BB and HR
    const summaryData = summaryRes.status === 'fulfilled'
      ? summaryRes.value as Record<string, unknown> | null
      : null;

    const hrData = (hrRes.status === 'fulfilled' ? hrRes.value : {}) as Record<string, unknown>;
    const summaryRestingHR = (summaryData?.restingHeartRateValue ?? summaryData?.restingHeartRate ?? 0) as number;
    const restingHR = ((hrData?.restingHeartRate ?? (hrData?.statisticsDTO as Record<string, unknown> | undefined)?.restingHeartRate ?? 0) as number) || summaryRestingHR;

    // Prefer whichever payload actually carries samples through the day.
    const bbRaw = bbReportRes.status === 'fulfilled' ? bbReportRes.value : null;
    const bodyBattery = parseBodyBattery(bbRaw, summaryData);
    if (bodyBattery.current > 0 && bodyBattery.data.length === 0 && bbReportRes.status === 'rejected') {
      const reason = bbReportRes.reason instanceof Error ? bbReportRes.reason.message : String(bbReportRes.reason);
      console.warn('[Garmin] body battery chart unavailable:', reason.slice(0, 160));
    }

    const stress = parseStress(
      stressRes.status === 'fulfilled' ? stressRes.value as Record<string, unknown> : {},
    );

    const allActivities = actsRes.status === 'fulfilled' ? actsRes.value as unknown[] ?? [] : [];
    const todayActivities = allActivities.filter((a: unknown) => {
      const act = a as Record<string, unknown>;
      const ts = (act.startTimeLocal ?? act.startTimeGMT ?? act.activityDate ?? '') as string;
      return String(ts).startsWith(date);
    });
    const activities = parseActivities(todayActivities)
      .map(a => ({ ...a, strain: calculateStrainScore([a], restingHR || 60) }));

    const steps = stepsRes.status === 'fulfilled' ? (stepsRes.value as number) ?? 0 : 0;
    const stepsTimeline = parseStepsTimeline(
      stepsChartRes.status === 'fulfilled' ? stepsChartRes.value : [],
    );
    if (steps > 0 && stepsTimeline.length === 0 && stepsChartRes.status === 'rejected') {
      const reason = stepsChartRes.reason instanceof Error ? stepsChartRes.reason.message : String(stepsChartRes.reason);
      console.warn('[Garmin] steps chart unavailable:', reason.slice(0, 160));
    }
    // Total daily calories from summary (includes BMR + NEAT + exercise)
    const totalCals = (
      (summaryData?.totalKilocalories ?? summaryData?.activeKilocalories ?? 0) as number
    ) || activities.reduce((s, a) => s + a.calories, 0);

    // Enriched background activity data from usersummary
    const floorsAscended     = (summaryData?.floorsAscended     ?? 0) as number;
    const highlyActiveSeconds = (summaryData?.highlyActiveSeconds ?? 0) as number;
    const activeSeconds       = (summaryData?.activeSeconds       ?? 0) as number;

    const dailyStrain = calculateDailyStrain(activities, steps, totalCals, {
      highlyActiveSeconds,
      activeSeconds,
      floorsAscended,
      stressAverage:       stress.average,
      bodyBatteryDrained:  bodyBattery.drained,  // HRV-derived physiological load
    });

    const baselineHRV = hrvTrend.filter(v => v > 0).reduce((s, v, _i, arr) => s + v / arr.length, 0) || hrv.weeklyAverage || 50;
    const recoveryScore = calculateRecoveryScore({
      lastNightHRV: hrv.lastNight || baselineHRV,
      baselineHRV,
      restingHR: restingHR || 60,
      baselineRHR: 62,
      sleepScore,
    });

    // Build weekly trend arrays (today real, rest from mock for now)
    const buildWeekly = (mock: number[], todayVal: number) =>
      [...mock.slice(0, 6), todayVal];

    const todaySleepHours = sleep.totalSleepSeconds / 3600;
    const weeklyTrend: WeeklyTrend = {
      dates: Array.from({ length: 7 }, (_, i) => format(subDays(today, 6 - i), 'EEE')),
      recovery: buildWeekly(mockData.weeklyTrend.recovery, recoveryScore),
      hrv: effectiveHrvTrend,
      sleep: buildWeekly(mockData.weeklyTrend.sleep, sleepScore),
      sleepHours: buildWeekly(mockData.weeklyTrend.sleepHours, todaySleepHours),
      rhr: [...mockData.weeklyTrend.rhr.slice(0, 6), restingHR || 60],
      strain: buildWeekly(mockData.weeklyTrend.strain, dailyStrain),
    };

    const metrics: DailyMetrics = {
      date,
      isDemo: false,
      recovery: {
        score: recoveryScore,
        category: getRecoveryCategory(recoveryScore),
        hrv: hrv.lastNight,
        restingHR,
        sleepScore,
      },
      sleep,
      hrv,
      bodyBattery,
      stress,
      activities,
      steps,
      stepsTimeline,
      calories: totalCals,
      floorsAscended,
      highlyActiveSeconds,
      activeSeconds,
      strain: dailyStrain,
      weeklyTrend,
    };

    cache.set(date, { data: metrics, ts: Date.now() });
    return metrics;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Garmin] fetch failed:', msg);
    return { ...mockData, date, isDemo: true, demoReason: 'fetch_error' };
  }
}

// ─── Historical trend fetching (for 30/90d charts) ────────────────────────────

interface DayTrendEntry { hrv: number; sleepHours: number; rhr: number; strain: number; ts: number }
const dayTrendCache = new Map<string, DayTrendEntry>();
const DAY_TREND_TTL = 4 * 60 * 60 * 1000; // 4h — historical data is immutable

interface TrendsCacheEntry { data: TrendPoint[]; ts: number }
const trendsCache = new Map<string, TrendsCacheEntry>();
const TRENDS_CACHE_TTL = 60 * 60 * 1000; // 1h

type GCClient = Record<string, (...args: unknown[]) => Promise<unknown>>;

async function fetchDayTrend(gc: GCClient, GC_API: string, date: string, displayName?: string): Promise<{ hrv: number; sleepHours: number; rhr: number; strain: number }> {
  // Check lightweight cache first
  const cached = dayTrendCache.get(date);
  if (cached && Date.now() - cached.ts < DAY_TREND_TTL) {
    return { hrv: cached.hrv, sleepHours: cached.sleepHours, rhr: cached.rhr, strain: cached.strain ?? 0 };
  }
  // Re-use full DailyMetrics cache if available
  const fullCached = cache.get(date);
  if (fullCached && Date.now() - fullCached.ts < CACHE_TTL) {
    const d = fullCached.data;
    return { hrv: d.hrv.lastNight, sleepHours: d.sleep.totalSleepSeconds / 3600, rhr: d.recovery.restingHR, strain: d.strain };
  }

  const today = new Date(date);
  const calls: Promise<unknown>[] = [
    gc.getSleepData(today),
    gc.get(`${GC_API}/hrv-service/hrv/${date}`),
    gc.getHeartRate(today),
  ];
  if (displayName) {
    calls.push(gc.get(`${GC_API}/usersummary-service/usersummary/daily/${displayName}?calendarDate=${date}`));
  }
  const [sleepRes, hrvRes, hrRes, summaryRes] = await Promise.allSettled(calls);

  const sleepRaw = (sleepRes.status === 'fulfilled' ? sleepRes.value : {}) as Record<string, unknown>;
  const sleepDTO = (sleepRaw?.dailySleepDTO ?? sleepRaw ?? {}) as Record<string, unknown>;
  const sleepSeconds = (sleepDTO.sleepTimeSeconds ?? sleepDTO.totalSleepSeconds ?? 0) as number;
  const sleepHRV = Number(sleepDTO.averageHrvValue ?? sleepDTO.averageHRV ?? 0);

  const hrvRaw = (
    hrvRes.status === 'fulfilled' && typeof hrvRes.value === 'object' && hrvRes.value !== null
      ? hrvRes.value : {}
  ) as Record<string, unknown>;
  const hrvSummary = (hrvRaw?.hrvSummary ?? hrvRaw) as Record<string, unknown>;
  const hrvMs = Number(hrvSummary.lastNight ?? hrvSummary.lastNightAvg ?? 0) || sleepHRV;

  const hrRaw = (hrRes.status === 'fulfilled' ? hrRes.value : {}) as Record<string, unknown>;
  const rhr = Number(
    hrRaw?.restingHeartRate ??
    (hrRaw?.statisticsDTO as Record<string, unknown> | undefined)?.restingHeartRate ??
    0
  );

  // Estimate daily strain from usersummary aggregates (no per-activity data needed)
  let strain = 0;
  if (summaryRes && summaryRes.status === 'fulfilled' && summaryRes.value) {
    const s = summaryRes.value as Record<string, unknown>;
    const highlyActiveSeconds = Number(s.highlyActiveSeconds ?? 0);
    const activeSeconds = Number(s.activeSeconds ?? 0);
    const steps = Number(s.totalSteps ?? s.steps ?? 0);
    const totalCals = Number(s.totalKilocalories ?? s.activeKilocalories ?? 0);
    const floorsAscended = Number(s.floorsAscended ?? 0);
    strain = calculateDailyStrain([], steps, totalCals, { highlyActiveSeconds, activeSeconds, floorsAscended, stressAverage: 0 });
  }

  const result = { hrv: hrvMs, sleepHours: Math.round((sleepSeconds / 3600) * 10) / 10, rhr, strain };
  dayTrendCache.set(date, { ...result, ts: Date.now() });
  return result;
}

// ── Demo/fallback trend generator ────────────────────────────────────────────
// Used when no Garmin credentials are configured. Produces a realistic 7-day
// training-cycle pattern so all pages work in demo mode.
function generateMockTrendPoints(range: number, endDateStr: string): TrendPoint[] {
  const endDate = new Date(endDateStr);
  // Strain by day-of-week (Sun=0…Sat=6): Sun=rest, Tue/Thu/Sat=hard, others=moderate
  const STRAIN_BY_DOW = [3.0, 8.5, 14.2, 9.5, 13.8, 8.0, 11.5];
  const HRV_OFFSET    = [+6,  0,   -5,   +2,  -4,   +1,  -2  ];
  const RHR_OFFSET    = [-2,  0,   +3,   0,   +3,   0,   +1  ];
  const SLEEP_OFFSET  = [+0.6, 0, -0.4, +0.2, -0.3, 0, +0.3];

  const HRV_BASE  = 50;
  const RHR_BASE  = 58;
  const SLEEP_BASE = 7.2;

  const dates = Array.from({ length: range }, (_, i) =>
    format(subDays(endDate, range - 1 - i), 'yyyy-MM-dd')
  );

  return dates.map((date, i) => {
    const dow = new Date(date).getDay();
    // Deterministic jitter using index
    const jitter = (Math.sin(i * 2.7 + 1.3) * 0.5); // -0.5..+0.5 range

    const strain      = Math.max(0, Math.min(21, STRAIN_BY_DOW[dow] + jitter * 3));
    const hrv         = Math.max(20, HRV_BASE   + HRV_OFFSET[dow]   + jitter * 6);
    const rhr         = Math.max(40, RHR_BASE   + RHR_OFFSET[dow]   + jitter * 3);
    const sleepHours  = Math.max(4,  SLEEP_BASE + SLEEP_OFFSET[dow]  + jitter * 0.5);

    // Compute recovery from hrv/rhr/sleep relative to a stable baseline
    const sleepScore  = Math.min(100, Math.round((sleepHours / 8) * 100));
    const recovery    = calculateRecoveryScore({
      lastNightHRV: hrv,
      baselineHRV:  HRV_BASE,
      restingHR:    rhr,
      baselineRHR:  RHR_BASE,
      sleepScore,
    });

    return {
      date,
      hrv:        Math.round(hrv * 10) / 10,
      sleepHours: Math.round(sleepHours * 10) / 10,
      rhr:        Math.round(rhr),
      recovery:   Math.round(recovery),
      strain:     Math.round(strain * 10) / 10,
    };
  });
}

export async function fetchTrendData(range: number, endDateStr: string): Promise<TrendPoint[]> {
  const cacheKey = `${endDateStr}-${range}`;
  const cached = trendsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TRENDS_CACHE_TTL) return cached.data;

  const client = await getClient();
  if (!client) {
    const mock = generateMockTrendPoints(range, endDateStr);
    trendsCache.set(cacheKey, { data: mock, ts: Date.now() });
    return mock;
  }

  const gc = client as GCClient;
  const GC_API = 'https://connectapi.garmin.com';
  const endDate = new Date(endDateStr);

  const dates = Array.from({ length: range }, (_, i) =>
    format(subDays(endDate, range - 1 - i), 'yyyy-MM-dd')
  );

  // Fetch displayName once so fetchDayTrend can request usersummary for strain
  let displayName: string | undefined;
  try {
    const profile = await gc.getUserProfile() as Record<string, unknown>;
    displayName = (profile?.displayName ?? profile?.userName) as string | undefined;
  } catch { /* optional */ }

  // Batch in groups of 7 to avoid overwhelming Garmin's API
  const BATCH = 7;
  const rawPoints: Array<{ hrv: number; sleepHours: number; rhr: number; strain: number }> = [];

  for (let i = 0; i < dates.length; i += BATCH) {
    const batch = dates.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(d => fetchDayTrend(gc, GC_API, d, displayName)));
    for (const r of results) {
      rawPoints.push(r.status === 'fulfilled' ? r.value : { hrv: 0, sleepHours: 0, rhr: 0, strain: 0 });
    }
    if (i + BATCH < dates.length) {
      await new Promise(res => setTimeout(res, 200));
    }
  }

  // Compute recovery using a rolling 7-day window as baseline
  const points: TrendPoint[] = dates.map((date, i) => {
    const pt = rawPoints[i];
    const window = rawPoints.slice(Math.max(0, i - 6), i + 1);
    const validHRV = window.filter(p => p.hrv > 0);
    const validRHR = window.filter(p => p.rhr > 0);
    const baseHRV = validHRV.length ? validHRV.reduce((s, p) => s + p.hrv, 0) / validHRV.length : 50;
    const baseRHR = validRHR.length ? validRHR.reduce((s, p) => s + p.rhr, 0) / validRHR.length : 62;
    const sleepScore = Math.min(100, Math.round((pt.sleepHours / 8) * 100));
    const recovery = (pt.hrv === 0 && pt.rhr === 0 && pt.sleepHours === 0)
      ? 0
      : calculateRecoveryScore({
          lastNightHRV: pt.hrv || baseHRV,
          baselineHRV: baseHRV,
          restingHR: pt.rhr || baseRHR,
          baselineRHR: baseRHR,
          sleepScore,
        });
    return { date, hrv: pt.hrv, sleepHours: pt.sleepHours, rhr: pt.rhr, recovery, strain: pt.strain };
  });

  trendsCache.set(cacheKey, { data: points, ts: Date.now() });
  return points;
}

function asKg(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 200 ? Math.round((n / 1000) * 100) / 100 : Math.round(n * 100) / 100;
}

function asNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null;
}

const weightCache = new Map<string, { data: ScaleReading[]; ts: number }>();

/** Index S2 (and other Garmin scales) body-composition history. */
export async function fetchScaleHistory(start: string, end: string): Promise<ScaleReading[]> {
  const key = `v2:${start}:${end}`;
  const cached = weightCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const client = await getClient();
  if (!client) return [];
  const gc = client as GCClient;
  const GC_API = 'https://connectapi.garmin.com';

  const attempts = [
    `${GC_API}/weight-service/weight/dateRange?startDate=${start}&endDate=${end}`,
    `${GC_API}/weight-service/weight/range/${start}/${end}`,
  ];
  let payload: unknown = null;
  for (const url of attempts) {
    try {
      payload = await gc.get(url);
      const list = (payload as { dateWeightList?: unknown[] } | null)?.dateWeightList;
      if (Array.isArray(list)) break;
    } catch {
      payload = null;
    }
  }

  const rows = (payload as { dateWeightList?: unknown[] } | null)?.dateWeightList ?? [];
  const readings = rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const rec = row as Record<string, unknown>;
    const weightKg = asKg(rec.weight);
    if (weightKg == null) return [];
    const stamp = parseGarminTime(rec.timestampGMT ?? rec.date);
    const date = typeof rec.calendarDate === 'string'
      ? rec.calendarDate
      : stamp
        ? format(stamp, 'yyyy-MM-dd')
        : '';
    if (!date) return [];
    const muscleRaw = asKg(rec.skeletalMuscleMass ?? rec.muscleMass);
    const muscle = muscleRaw != null && muscleRaw >= 15 && muscleRaw <= 80 ? muscleRaw : null;
    return [{
      date,
      time: stamp ? stamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
      weightKg,
      bmi: asNum(rec.bmi),
      bodyFat: asNum(rec.bodyFat),
      muscleKg: muscle,
      boneKg: asKg(rec.boneMass),
      bodyWater: asNum(rec.bodyWater),
      visceralFat: asNum(rec.visceralFat),
    }];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  if (payload) weightCache.set(key, { data: readings, ts: Date.now() });
  return readings;
}
