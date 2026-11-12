import type { ScaleReading } from '@/lib/types';

export type BalanceStatus = 'maintenance' | 'surplus' | 'deficit';

export interface WeekAssessment {
  status: BalanceStatus;
  note: string;
  readings: number;
  weightDelta: number;
  fatDelta: number | null;
  muscleDelta: number | null;
  waterDelta: number | null;
  lines: string[];
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function signed(value: number, digits: number) {
  const text = round(value, digits).toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

function series(readings: ScaleReading[], pick: (reading: ScaleReading) => number | null) {
  return readings
    .map(pick)
    .filter((value): value is number => value != null && Number.isFinite(value));
}

/** Second-half average minus first-half average, so one odd morning does not decide the week. */
function halfChange(values: number[]) {
  if (values.length < 2) return null;
  const half = Math.ceil(values.length / 2);
  const mean = (slice: number[]) => slice.reduce((sum, value) => sum + value, 0) / slice.length;
  return round(mean(values.slice(-half)) - mean(values.slice(0, half)), 2);
}

function opposite(a: number | null, b: number | null) {
  if (a == null || b == null || a === 0 || b === 0) return false;
  return Math.sign(a) !== Math.sign(b);
}

/** Index S2 reports higher body fat when body water is lower. That pairing is hydration, not tissue. */
function fatFollowsHydration(fatDelta: number | null, waterDelta: number | null) {
  return opposite(fatDelta, waterDelta)
    && Math.abs(fatDelta ?? 0) >= 0.2
    && Math.abs(waterDelta ?? 0) >= 0.15;
}

function classify(
  weightDelta: number,
  fatDelta: number | null,
  waterDelta: number | null,
): BalanceStatus {
  const waterMoved = waterDelta != null && Math.abs(waterDelta) >= 0.4;
  const waterSameWay = waterMoved && Math.sign(waterDelta) === Math.sign(weightDelta);
  // Body-fat percent and a same-day water shift are not a calorie surplus or deficit.
  if (fatFollowsHydration(fatDelta, waterDelta) || (waterSameWay && Math.abs(weightDelta) < 0.8)) {
    return 'maintenance';
  }
  if (weightDelta >= 0.45) return 'surplus';
  if (weightDelta <= -0.45) return 'deficit';
  return 'maintenance';
}

function noteFor(status: BalanceStatus, weightDelta: number, weightSwing: number) {
  const held = `Weight ${signed(weightDelta, 2)} kg from the first half of the week to the second, inside a ${weightSwing.toFixed(2)} kg bounce.`;
  if (status === 'maintenance') {
    return `${held} That bounce is fluid and glycogen. Weight that keeps landing in the same place is maintenance, including on weeks the scale looks all over the place.`;
  }
  const direction = status === 'deficit' ? 'lower' : 'higher';
  return `${held} The scale finished the week ${direction}. One week at a new number can still be a refill or a drier weigh-in. A change in calories wants a trend that stays up or stays down, not one bounce.`;
}

/** Usual adult total-body-water range. Lean muscle often sits near the top, or a few points above it. */
export function bodyWaterGuide(sex: 'male' | 'female' | null | undefined) {
  if (sex === 'female') return { low: 45, high: 60 };
  return { low: 50, high: 65 };
}

/** A real dip in body water, not a tenth of a point of scale noise. */
export function hydrationCaution(readings: ScaleReading[]): { low: number; drop: number } | null {
  const waters = readings
    .map(reading => reading.bodyWater)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (waters.length < 3) return null;
  const drop = round(Math.max(...waters) - Math.min(...waters), 1);
  if (drop < 1) return null;
  return { low: round(Math.min(...waters), 1), drop };
}

/** Rough energy-balance read from one week of Index S2 weigh-ins. */
export function assessWeek(readings: ScaleReading[]): WeekAssessment | null {
  const ordered = [...readings].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const weightDelta = halfChange(series(ordered, reading => reading.weightKg));
  if (weightDelta == null) return null;

  const fatDelta = halfChange(series(ordered, reading => reading.bodyFat));
  const muscleDelta = halfChange(series(ordered, reading => reading.muscleKg));
  const waterDelta = halfChange(series(ordered, reading => reading.bodyWater));
  const weights = series(ordered, reading => reading.weightKg);
  const weightSwing = weights.length ? round(Math.max(...weights) - Math.min(...weights), 2) : 0;
  const status = classify(weightDelta, fatDelta, waterDelta);

  const lines = ordered.map(reading => {
    const bits = [`${reading.date}: ${reading.weightKg.toFixed(2)} kg`];
    if (reading.bodyFat != null) bits.push(`fat ${reading.bodyFat.toFixed(1)}%`);
    if (reading.muscleKg != null) bits.push(`muscle ${reading.muscleKg.toFixed(2)} kg`);
    if (reading.bodyWater != null) bits.push(`water ${reading.bodyWater.toFixed(1)}%`);
    return bits.join(', ');
  });

  return {
    status,
    note: noteFor(status, weightDelta, weightSwing),
    readings: ordered.length,
    weightDelta,
    fatDelta,
    muscleDelta,
    waterDelta,
    lines,
  };
}
