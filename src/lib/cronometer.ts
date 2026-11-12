import { createHmac } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { NutritionDay } from '@/lib/types';

const BASE = 'https://mobile.cronometer.com';
const SESSION_PATH = path.join(process.cwd(), '.cronometer-session.json');
const APP_AUTH = { api: 3, os: 'Android', build: '2807', flavour: 'free' };

const ENERGY = 208;
const PROTEIN = 203;
const FAT = 204;
const NET_CARBS = -1205;

interface Session {
  userId: number;
  token: string;
}

let memory: Session | null = null;
let loginInFlight: Promise<Session> | null = null;

function loadSession(): Session | null {
  if (memory) return memory;
  try {
    const saved = JSON.parse(readFileSync(SESSION_PATH, 'utf8')) as Session;
    if (saved.userId && saved.token) {
      memory = saved;
      return saved;
    }
  } catch { /* no cached session */ }
  return null;
}

function saveSession(session: Session) {
  memory = session;
  try { writeFileSync(SESSION_PATH, JSON.stringify(session)); } catch { /* ignore */ }
}

function clearSession() {
  memory = null;
  try { writeFileSync(SESSION_PATH, ''); } catch { /* ignore */ }
}

function base32ToBuffer(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = secret.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (const char of cleaned) {
    const value = alphabet.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpCode(secret: string) {
  const key = base32ToBuffer(secret);
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

function cronoDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}-${month}-${day}`;
}

async function login(): Promise<Session> {
  const email = process.env.CRONOMETER_USERNAME;
  const password = process.env.CRONOMETER_PASSWORD;
  if (!email || !password) {
    throw new Error('missing_credentials');
  }
  const totp = process.env.CRONOMETER_TOTP_SECRET;
  const response = await fetch(`${BASE}/api/v2/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      timezone: null,
      userCode: totp ? totpCode(totp) : null,
      build: '4.48.2 b2807-a',
      device: 'Android 14 (SDK 34), Google Pixel 6 Pro',
      firebaseToken: '',
      features: {
        food_search_config: '{"newSearch": true, "newSpellcheck": true}',
        use_gpt_autofill: 'true',
      },
      auth: { userId: null, token: null, ...APP_AUTH },
      lastSeen: 0,
      config: { call_version: 2 },
    }),
  });
  const data = await response.json() as Record<string, unknown>;
  const sessionKey = data.sessionKey ?? data.token;
  const userId = data.id ?? data.userId;
  if (typeof sessionKey === 'string' && userId != null) {
    const session = { userId: Number(userId), token: sessionKey };
    saveSession(session);
    return session;
  }
  const reason = typeof data.error === 'string'
    ? data.error
    : typeof data.result === 'string'
      ? data.result
      : 'login_failed';
  console.error('[nutrition] login rejected', response.status, reason.slice(0, 80));
  if (/TOTP|MFA|TWO_FACTOR|userCode/i.test(reason)) throw new Error('totp_required');
  if (/TOO_MANY|RATE|LOCK/i.test(reason)) throw new Error('rate_limited');
  throw new Error('login_failed');
}

async function session(): Promise<Session> {
  const cached = loadSession();
  if (cached) return cached;
  if (!loginInFlight) {
    loginInFlight = login().finally(() => { loginInFlight = null; });
  }
  return loginInFlight;
}

async function post(endpoint: string, payload: Record<string, unknown>, retry = false): Promise<unknown> {
  const auth = await session();
  const response = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      lastSeen: 0,
      auth: { userId: auth.userId, token: auth.token, ...APP_AUTH },
    }),
  });
  const data = await response.json() as Record<string, unknown>;
  const failed = response.status === 401 || response.status === 403 || data.result === 'FAIL' || data.result === 'FAILURE';
  if (failed && !retry) {
    clearSession();
    return post(endpoint, payload, true);
  }
  if (!response.ok || data.result === 'FAIL' || data.result === 'FAILURE') {
    throw new Error('request_failed');
  }
  return data;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function amountFor(rows: unknown, id: number): number | null {
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const rowId = asNumber(record.id ?? record.nutrientId);
    if (rowId !== id) continue;
    return asNumber(record.amount ?? record.value ?? record.total);
  }
  return null;
}

function targetFor(rows: unknown, id: number): number | null {
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const rowId = asNumber(record.id ?? record.nutrientId);
    if (rowId !== id) continue;
    return asNumber(record.min ?? record.max ?? record.target);
  }
  return null;
}

function sumDiary(entries: unknown, id: number) {
  if (!Array.isArray(entries)) return null;
  let total = 0;
  let found = false;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const fromNutrients = amountFor(record.nutrients ?? record.nutrition, id);
    if (fromNutrients != null) {
      total += fromNutrients;
      found = true;
    }
  }
  return found ? total : null;
}

function exerciseBurn(entries: unknown): number | null {
  if (!Array.isArray(entries)) return null;
  let total = 0;
  let found = false;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const type = String(record.type ?? '');
    if (!/exercise|activity/i.test(type)) continue;
    const calories = asNumber(record.calories ?? record.energy ?? record.kcal);
    if (calories == null) continue;
    total += Math.abs(calories);
    found = true;
  }
  return found ? total : null;
}

export async function fetchNutritionDay(date: string): Promise<NutritionDay> {
  const day = cronoDay(date);
  const [diary, targets] = await Promise.all([
    post('/api/v2/get_diary', { day, config: { call_version: 1 } }),
    post('/api/v2/get_targets', { config: { call_version: 1 } }).catch(() => null),
  ]);

  const diaryRecord = diary as Record<string, unknown>;
  const sketch = (value: unknown, depth = 0): unknown => {
    if (Array.isArray(value)) return { len: value.length, first: depth > 2 ? typeof value[0] : sketch(value[0], depth + 1) };
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([key, item]) => {
        if (typeof item === 'string') return [key, `str:${item.length}`];
        if (typeof item === 'number' || typeof item === 'boolean' || item == null) return [key, item];
        return [key, depth > 1 ? (Array.isArray(item) ? `arr:${item.length}` : typeof item) : sketch(item, depth + 1)];
      }));
    }
    return typeof value;
  };
  console.error('[nutrition] shape', JSON.stringify({
    keys: Object.keys(diaryRecord),
    summary: sketch(diaryRecord.summary),
    diary: sketch(diaryRecord.diary),
    targetKeys: targets && typeof targets === 'object' ? Object.keys(targets as object) : null,
    targetFirst: sketch(targets && typeof targets === 'object' ? (targets as Record<string, unknown>).targets : null),
  }));
  const summary = diaryRecord.summary;
  const summaryRows = Array.isArray(summary)
    ? summary
    : summary && typeof summary === 'object'
      ? (summary as Record<string, unknown>).nutrients ?? (summary as Record<string, unknown>).nutrientTotals
      : null;
  const entries = diaryRecord.diary;

  const consumed = amountFor(summaryRows, ENERGY) ?? sumDiary(entries, ENERGY) ?? 0;
  const protein = amountFor(summaryRows, PROTEIN) ?? sumDiary(entries, PROTEIN) ?? 0;
  const fat = amountFor(summaryRows, FAT) ?? sumDiary(entries, FAT) ?? 0;
  const netCarbs = amountFor(summaryRows, NET_CARBS) ?? sumDiary(entries, NET_CARBS) ?? 0;

  const targetRows = targets && typeof targets === 'object'
    ? (targets as Record<string, unknown>).targets
    : null;
  const summaryTarget = (id: number) => {
    if (!Array.isArray(summaryRows)) return null;
    for (const row of summaryRows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      if (asNumber(record.id ?? record.nutrientId) !== id) continue;
      return asNumber(record.target ?? record.min ?? record.max);
    }
    return null;
  };

  const energyTarget = summaryTarget(ENERGY) ?? targetFor(targetRows, ENERGY);
  const burned = exerciseBurn(entries);
  const net = burned != null ? consumed - burned : null;
  const remaining = energyTarget != null ? energyTarget - consumed : null;

  return {
    date,
    consumed: Math.round(consumed),
    burned: burned == null ? null : Math.round(burned),
    net: net == null ? null : Math.round(net),
    target: energyTarget == null ? null : Math.round(energyTarget),
    remaining: remaining == null ? null : Math.round(remaining),
    protein: { consumed: Math.round(protein * 10) / 10, target: targetFor(targetRows, PROTEIN) ?? summaryTarget(PROTEIN) },
    netCarbs: { consumed: Math.round(netCarbs * 10) / 10, target: targetFor(targetRows, NET_CARBS) ?? summaryTarget(NET_CARBS) },
    fat: { consumed: Math.round(fat * 10) / 10, target: targetFor(targetRows, FAT) ?? summaryTarget(FAT) },
  };
}

export function cronometerConfigured() {
  return Boolean(process.env.CRONOMETER_USERNAME && process.env.CRONOMETER_PASSWORD);
}
