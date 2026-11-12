'use client';

import { useMemo } from 'react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { BodyBatteryData, SleepData, StressData } from '@/lib/types';

interface Props {
  battery: BodyBatteryData;
  stress: StressData;
  sleep: SleepData;
}

interface Point {
  minute: number;
  battery: number | null;
  sleepFill: number | null;
  dayFill: number | null;
  stress: number | null;
  resting: boolean;
}

const ZONES: Record<number, string> = { 25: 'Rest', 50: 'Low', 75: 'Medium', 100: 'High' };
const AXIS_TICKS = [0, 360, 720, 1080, 1440];

function minutesOf(value: unknown, wallClock = false): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    // Garmin *TimestampLocal epochs encode the wall clock in UTC fields.
    return wallClock
      ? d.getUTCHours() * 60 + d.getUTCMinutes()
      : d.getHours() * 60 + d.getMinutes();
  }
  if (typeof value !== 'string' || !value) return null;
  if (/^\d{10,}$/.test(value)) return minutesOf(Number(value));
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (/am/i.test(value) && hour === 12) hour = 0;
  else if (/pm/i.test(value) && hour < 12) hour += 12;
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function inWindow(minute: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null) return false;
  if (end >= start) return minute >= start && minute <= end;
  return minute >= start || minute <= end;
}

function batteryAt(minute: number, samples: { minute: number; value: number }[]): number | null {
  if (!samples.length) return null;
  if (minute <= samples[0].minute) return samples[0].value;
  const last = samples[samples.length - 1];
  if (minute >= last.minute) return last.value;
  for (let i = 1; i < samples.length; i++) {
    const next = samples[i];
    if (minute <= next.minute) {
      const prev = samples[i - 1];
      const span = next.minute - prev.minute || 1;
      const t = (minute - prev.minute) / span;
      return prev.value + (next.value - prev.value) * t;
    }
  }
  return last.value;
}

function clock(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h < 12 ? 'a' : 'p';
  const hour = h % 12 || 12;
  if (m === 0) return `${hour}${suffix}`;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

function buildSeries(battery: BodyBatteryData, stress: StressData, sleep: SleepData): {
  points: Point[];
  sleepStart: number | null;
  sleepEnd: number | null;
} {
  const samples = battery.data
    .map((d) => ({ minute: minutesOf(d.time), value: d.value }))
    .filter((d): d is { minute: number; value: number } => d.minute != null)
    .sort((a, b) => a.minute - b.minute);

  const sleepStart = minutesOf(sleep.startTime, true);
  const sleepEnd = minutesOf(sleep.endTime, true);
  const stressPoints = stress.data
    .map((d) => ({ minute: minutesOf(d.time), value: d.value }))
    .filter((d): d is { minute: number; value: number } => d.minute != null && d.value >= 0)
    .sort((a, b) => a.minute - b.minute);

  const step = Math.max(1, Math.ceil(stressPoints.length / 140));
  const anchors = new Map<number, number | null>();
  for (const sample of samples) anchors.set(sample.minute, null);
  stressPoints.forEach((point, index) => {
    if (index % step === 0) anchors.set(point.minute, point.value);
  });

  const points = [...anchors.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minute, stressValue]) => {
      const level = batteryAt(minute, samples);
      const asleep = inWindow(minute, sleepStart, sleepEnd);
      const resting = asleep;
      return {
        minute,
        battery: level,
        sleepFill: asleep ? level : null,
        dayFill: asleep ? null : level,
        stress: stressValue,
        resting,
      };
    });

  return { points, sleepStart, sleepEnd };
}

function Tip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-[#111] px-2.5 py-1.5 text-[10px] shadow-lg">
      <p className="text-gray-300">{clock(row.minute)}</p>
      {row.battery != null && <p className="text-white">Body Battery {Math.round(row.battery)}</p>}
      {row.stress != null && (
        <p style={{ color: row.resting ? '#60a5fa' : '#fb923c' }}>
          {row.resting ? 'Rest' : 'Stress'} {Math.round(row.stress)}
        </p>
      )}
    </div>
  );
}

export default function BodyBatteryTimeline({ battery, stress, sleep }: Props) {
  const { points, sleepStart, sleepEnd } = useMemo(
    () => buildSeries(battery, stress, sleep),
    [battery, stress, sleep],
  );

  if (!points.length) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 6, right: 2, bottom: 0, left: 0 }}>
            <CartesianGrid horizontal={false} vertical={false} />
            {[25, 50, 75].map((y) => (
              <ReferenceLine key={y} y={y} stroke="#ffffff" strokeOpacity={0.12} strokeDasharray="3 4" />
            ))}
            {sleepStart != null && (
              <ReferenceLine x={sleepStart} stroke="#ffffff" strokeOpacity={0.35} strokeDasharray="3 3" />
            )}
            {sleepEnd != null && (
              <ReferenceLine x={sleepEnd} stroke="#ffffff" strokeOpacity={0.35} strokeDasharray="3 3" />
            )}
            <XAxis
              dataKey="minute"
              type="number"
              domain={[0, 1440]}
              ticks={AXIS_TICKS}
              tickFormatter={clock}
              tick={{ fill: '#6b7280', fontSize: 9 }}
              interval={0}
              padding={{ left: 8, right: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              orientation="right"
              domain={[0, 100]}
              ticks={[25, 50, 75, 100]}
              tickFormatter={(v: number) => ZONES[v] ?? ''}
              tick={{ fill: '#9ca3af', fontSize: 8 }}
              width={42}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<Tip />} cursor={{ stroke: '#ffffff', strokeOpacity: 0.2 }} />
            <Area
              dataKey="dayFill"
              type="monotone"
              stroke="none"
              fill="#9ca3af"
              fillOpacity={0.38}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Area
              dataKey="sleepFill"
              type="monotone"
              stroke="none"
              fill="#3b82f6"
              fillOpacity={0.55}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Bar
              dataKey="stress"
              barSize={2}
              isAnimationActive={false}
              shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: Point }) => {
                const { x = 0, y = 0, width = 0, height = 0, payload } = props;
                if (!payload?.stress) return <g />;
                return <rect x={x} y={y} width={Math.max(width, 1.5)} height={height} fill={payload.resting ? '#60a5fa' : '#fb923c'} />;
              }}
            />
            <Line
              dataKey="battery"
              type="monotone"
              stroke="#f5f5f5"
              strokeWidth={1.75}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[9px] text-gray-500">
        <span className="flex items-center gap-1"><i className="inline-block h-1.5 w-2.5 rounded-sm bg-blue-500" /> Sleep</span>
        <span className="flex items-center gap-1"><i className="inline-block h-1.5 w-2.5 rounded-sm bg-orange-400" /> Stress</span>
        <span className="flex items-center gap-1"><i className="inline-block h-[2px] w-2.5 bg-white" /> Body Battery</span>
      </div>
    </div>
  );
}
