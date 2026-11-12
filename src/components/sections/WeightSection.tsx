'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek, subDays } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { Calendar, ChevronLeft, ChevronRight, Scale } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useLang } from '@/lib/i18n';
import type { ScaleReading } from '@/lib/types';
import SectionShell from './SectionShell';
import WeightBalanceCard from '../WeightBalanceCard';
import { hydrationCaution } from '@/lib/weightBalance';

const RANGES = [
  { days: 1, key: 'weightLog.ranges.today' },
  { days: 7, key: 'weightLog.ranges.d7' },
  { days: 28, key: 'weightLog.ranges.w4' },
  { days: 84, key: 'weightLog.ranges.w12' },
  { days: 182, key: 'weightLog.ranges.w26' },
  { days: 365, key: 'weightLog.ranges.y1' },
] as const;

type MetricKey = 'weightKg' | 'bodyFat' | 'muscleKg' | 'bmi';

const METRICS: { key: MetricKey; label: string; unit: string; color: string; digits: number }[] = [
  { key: 'weightKg', label: 'weightLog.weight', unit: 'kg', color: '#38bdf8', digits: 2 },
  { key: 'bodyFat', label: 'weightLog.bodyFat', unit: '%', color: '#facc15', digits: 1 },
  { key: 'muscleKg', label: 'weightLog.muscle', unit: 'kg', color: '#4ade80', digits: 2 },
  { key: 'bmi', label: 'weightLog.bmi', unit: '', color: '#c084fc', digits: 1 },
];

function dailyPoints(readings: ScaleReading[], key: MetricKey) {
  return readings.flatMap(reading => {
    const value = reading[key];
    if (value == null) return [];
    return [{
      label: format(parseISO(reading.date), 'MMM d', { locale: enUS }),
      value,
    }];
  });
}

function weeklyAverage(readings: ScaleReading[], key: MetricKey) {
  const buckets = new Map<string, { sum: number; n: number }>();
  for (const reading of readings) {
    const value = reading[key];
    if (value == null) continue;
    const week = format(startOfWeek(parseISO(reading.date), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const bucket = buckets.get(week) ?? { sum: 0, n: 0 };
    bucket.sum += value;
    bucket.n += 1;
    buckets.set(week, bucket);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, bucket]) => ({
    label: format(parseISO(week), 'MMM d', { locale: enUS }),
    value: Math.round((bucket.sum / bucket.n) * 100) / 100,
  }));
}

function formatValue(value: number, digits: number) {
  return value.toFixed(digits);
}

export default function WeightSection() {
  const { t } = useLang();
  const [span, setSpan] = useState(84);
  const [end, setEnd] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [readings, setReadings] = useState<ScaleReading[] | null>(null);
  const [failed, setFailed] = useState(false);
  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    let cancel = false;
    setFailed(false);
    fetch('/api/weight?days=365')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ readings: ScaleReading[] }>;
      })
      .then(json => {
        if (!cancel) setReadings(json.readings ?? []);
      })
      .catch(() => {
        if (!cancel) setFailed(true);
      });
    return () => { cancel = true; };
  }, []);

  const earliest = readings?.[0]?.date ?? today;
  const endDate = parseISO(end);
  const windowStart = format(subDays(endDate, span - 1), 'yyyy-MM-dd');
  const visible = useMemo(
    () => (readings ?? []).filter(reading => reading.date >= windowStart && reading.date <= end),
    [readings, windowStart, end],
  );
  const weekStart = format(subDays(endDate, 6), 'yyyy-MM-dd');
  const weekReadings = useMemo(
    () => (readings ?? []).filter(reading => reading.date >= weekStart && reading.date <= end),
    [readings, weekStart, end],
  );
  const warnHydration = hydrationCaution(weekReadings) != null;
  const latest = visible[visible.length - 1];
  const previous = latest
    ? [...(readings ?? [])].reverse().find(reading => reading.date < latest.date || (reading.date === latest.date && reading.time < latest.time))
    : undefined;

  const rangeLabel = useMemo(() => {
    const start = subDays(endDate, span - 1);
    if (span === 1) return format(endDate, 'MMM d', { locale: enUS });
    const sameYear = start.getFullYear() === endDate.getFullYear();
    const startText = format(start, sameYear ? 'MMM d' : 'MMM d, yyyy', { locale: enUS });
    const endText = format(endDate, sameYear ? 'MMM d' : 'MMM d, yyyy', { locale: enUS });
    return `${startText} – ${endText}`;
  }, [endDate, span]);

  const shiftEnd = (by: number) => {
    const next = format(addDays(endDate, by), 'yyyy-MM-dd');
    setEnd(next > today ? today : next < earliest ? earliest : next);
  };

  const weightSeries = useMemo(() => visible.map(reading => ({
    label: format(parseISO(reading.date), 'MMM d', { locale: enUS }),
    tip: `${format(parseISO(reading.date), 'MMM d', { locale: enUS })}${reading.time ? ` · ${reading.time}` : ''}`,
    value: reading.weightKg,
  })), [visible]);

  return (
    <SectionShell
      id="weight"
      title={t('weightLog.title')}
      icon={<Scale size={16} className="text-battery" />}
      center={
        <div className="flex flex-col items-stretch gap-1.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t('weightLog.previousDay')}
              disabled={end <= earliest}
              onClick={() => shiftEnd(-1)}
              className="p-1 rounded-full border border-border text-secondary hover:text-primary disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-primary min-w-[9.5rem] justify-center">
              <Calendar size={13} className="text-secondary" />
              <span>{rangeLabel}</span>
            </div>
            <button
              type="button"
              aria-label={t('weightLog.nextDay')}
              disabled={end >= today}
              onClick={() => shiftEnd(1)}
              className="p-1 rounded-full border border-border text-secondary hover:text-primary disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, differenceInCalendarDays(parseISO(today), parseISO(earliest)))}
            value={Math.max(0, differenceInCalendarDays(endDate, parseISO(earliest)))}
            onChange={event => {
              const next = format(addDays(parseISO(earliest), Number(event.target.value)), 'yyyy-MM-dd');
              setEnd(next > today ? today : next);
            }}
            aria-label={rangeLabel}
            className="w-full h-1 accent-[#38bdf8] cursor-pointer"
          />
        </div>
      }
      right={
        <div className="flex gap-1">
          {RANGES.map(range => (
            <button
              key={range.days}
              onClick={() => {
                setSpan(range.days);
                if (range.days === 1) setEnd(today);
              }}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                span === range.days
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'border-border text-secondary'
              }`}
            >
              {t(range.key)}
            </button>
          ))}
        </div>
      }
    >
      <div className="col-span-full flex flex-col gap-4">
        {readings == null && !failed && (
          <div className="card text-xs text-muted">{t('weightLog.loading')}</div>
        )}
        {failed && (
          <div className="card text-xs text-secondary">{t('dashboard.error')}</div>
        )}
        {readings && readings.length === 0 && (
          <div className="card text-xs text-muted">{t('weightLog.empty')}</div>
        )}
        {readings && readings.length > 0 && visible.length === 0 && (
          <div className="card text-xs text-muted">{t('weightLog.noWeighIn')}</div>
        )}

        {weekReadings.length >= 2 && (
          <WeightBalanceCard readings={weekReadings} />
        )}

        {latest && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {METRICS.map(metric => {
              const value = latest[metric.key];
              const prior = previous?.[metric.key];
              const delta = value != null && prior != null ? Math.round((value - prior) * 100) / 100 : null;
              return (
                <div key={metric.key} className="card !p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted">{t(metric.label)}</p>
                  <p className="text-2xl font-black leading-none mt-1" style={{ color: metric.color }}>
                    {value == null ? '—' : formatValue(value, metric.digits)}
                    {value != null && metric.unit && (
                      <span className="text-xs font-medium text-secondary ml-1">{metric.unit}</span>
                    )}
                  </p>
                  {delta != null && delta !== 0 && (
                    <p className={`text-[10px] mt-1 ${delta < 0 ? 'text-recovery-green' : 'text-secondary'}`}>
                      {delta > 0 ? '+' : ''}{formatValue(delta, metric.digits)} {t('weightLog.change')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {weightSeries.length > 1 && (
          <div className="card">
            <div className="card-header">
              <span>{t('weightLog.weight')}</span>
              <span className="ml-auto text-[10px] text-muted normal-case tracking-normal">{t('weightLog.chart')}</span>
            </div>
            <div className="h-52">
              <ReadingChart
                data={weightSeries}
                color="#38bdf8"
                unit="kg"
                digits={2}
              />
            </div>
          </div>
        )}

        {visible.length > 0 && span > 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {METRICS.filter(metric => metric.key !== 'weightKg').map(metric => {
              const weeks = span <= 7 ? dailyPoints(visible, metric.key) : weeklyAverage(visible, metric.key);
              return (
                <div key={metric.key} className="card">
                  <div className="card-header">
                    <span>{t(metric.label)}</span>
                    <span className="ml-auto text-[10px] text-muted normal-case tracking-normal">
                      {t(span <= 7 ? 'weightLog.daily' : 'weightLog.weekly')}
                    </span>
                  </div>
                  {weeks.length > 0 ? (
                    <div className="h-40">
                      <WeeklyChart data={weeks} color={metric.color} unit={metric.unit} digits={metric.digits} />
                    </div>
                  ) : (
                    <p className="text-xs text-muted">{t('weightLog.empty')}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {latest && (latest.boneKg != null || (latest.bodyWater != null && !warnHydration)) && (
          <div className={`grid gap-3 ${latest.boneKg != null && latest.bodyWater != null && !warnHydration ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {latest.boneKg != null && (
              <div className="card !p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted">{t('weightLog.bone')}</p>
                <p className="text-xl font-black text-primary mt-1">{latest.boneKg.toFixed(2)} <span className="text-xs font-medium text-secondary">kg</span></p>
              </div>
            )}
            {latest.bodyWater != null && !warnHydration && (
              <div className="card !p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted">{t('weightLog.water')}</p>
                <p className="text-xl font-black text-primary mt-1">{latest.bodyWater.toFixed(1)} <span className="text-xs font-medium text-secondary">%</span></p>
              </div>
            )}
          </div>
        )}
      </div>
    </SectionShell>
  );
}

function ReadingChart({
  data, color, unit, digits,
}: {
  data: { label: string; tip: string; value: number }[];
  color: string;
  unit: string;
  digits: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id={`scale-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          interval={data.length > 8 ? Math.floor(data.length / 6) : 0}
        />
        <YAxis
          domain={['auto', 'auto']}
          tick={{ fontSize: 9, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as { tip?: string; value?: number } | undefined;
            if (!active || !point || point.value == null) return null;
            return (
              <div className="rounded-md bg-surface border border-border px-2 py-1 text-xs">
                <p className="text-secondary">{point.tip}</p>
                <p className="font-semibold" style={{ color }}>{point.value.toFixed(digits)} {unit}</p>
              </div>
            );
          }}
        />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#scale-${color.slice(1)})`} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function WeeklyChart({
  data, color, unit, digits,
}: {
  data: { label: string; value: number }[];
  color: string;
  unit: string;
  digits: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          interval={data.length > 8 ? Math.floor(data.length / 5) : 0}
        />
        <YAxis
          domain={['auto', 'auto']}
          tick={{ fontSize: 9, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          cursor={{ fill: '#ffffff10' }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as { label?: string; value?: number } | undefined;
            if (!active || !point || point.value == null) return null;
            return (
              <div className="rounded-md bg-surface border border-border px-2 py-1 text-xs">
                <p className="text-secondary">{point.label}</p>
                <p className="font-semibold" style={{ color }}>{point.value.toFixed(digits)} {unit}</p>
              </div>
            );
          }}
        />
        <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
