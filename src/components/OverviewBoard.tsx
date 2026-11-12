'use client';

import {
  Activity, BatteryMedium, Brain, Flame, Footprints, Gauge, Moon,
} from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart, ReferenceLine } from 'recharts';
import type { ReactNode } from 'react';
import type { DailyMetrics, StepSample, UserProfile } from '@/lib/types';
import BodyBatteryTimeline from './BodyBatteryTimeline';
import type { ProfileBenchmarks } from '@/lib/benchmarks';
import CircularGauge from './ui/CircularGauge';
import InsightsCard from './InsightsCard';
import { useLang } from '@/lib/i18n';
import { formatDuration, getCategoryColor, getStrainColor } from '@/lib/scoring';

interface Props {
  data: DailyMetrics;
  profile: UserProfile | null;
  benchmarks: ProfileBenchmarks | null;
}

function Tile({
  icon,
  title,
  extra,
  children,
}: {
  icon: ReactNode;
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card h-full min-h-[210px] lg:min-h-0 !p-3 flex flex-col overflow-hidden">
      <div className="card-header !mb-2 shrink-0">
        {icon}
        <span>{title}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}

function batteryColor(value: number) {
  if (value >= 70) return '#4ade80';
  if (value >= 40) return '#facc15';
  return '#f87171';
}

function stressColor(value: number) {
  if (value <= 25) return '#4ade80';
  if (value <= 50) return '#facc15';
  if (value <= 75) return '#fb923c';
  return '#f87171';
}

export default function OverviewBoard({ data, profile, benchmarks }: Props) {
  const { t, locale } = useLang();
  const recoveryColor = getCategoryColor(data.recovery.score);
  const recoveryLabel = data.recovery.category === 'green'
    ? t('common.recovered')
    : data.recovery.category === 'yellow'
      ? t('common.moderate')
      : t('common.fatigued');

  const sleepHours = data.weeklyTrend.sleepHours;
  const maxSleep = Math.max(8, ...sleepHours, 0.1);
  const totalSleep = data.sleep.totalSleepSeconds;
  const stages = [
    { key: 'deep', seconds: data.sleep.deepSleepSeconds, color: '#818cf8' },
    { key: 'rem', seconds: data.sleep.remSleepSeconds, color: '#c084fc' },
    { key: 'light', seconds: data.sleep.lightSleepSeconds, color: '#38bdf8' },
    { key: 'awake', seconds: data.sleep.awakeSleepSeconds, color: '#404040' },
  ];

  const hrvColor = data.hrv.status === 'balanced' ? '#4ade80' : data.hrv.status === 'unbalanced' ? '#facc15' : '#f87171';
  const hrvLabel = data.hrv.status === 'balanced'
    ? t('hrv.states.balanced')
    : data.hrv.status === 'unbalanced'
      ? t('hrv.states.unbalanced')
      : t('hrv.states.low');
  const hrvSeries = (data.hrv.trend.length ? data.hrv.trend : [data.hrv.lastNight]).map((v, i) => ({
    v,
    label: data.weeklyTrend.dates[i] ?? '',
  }));

  const bb = data.bodyBattery;
  const bbColor = batteryColor(bb.current);
  const strainColor = getStrainColor(data.strain);
  const strainMax = Math.max(14, ...data.weeklyTrend.strain, 1);
  const stressAvg = data.stress.average;
  const stressTint = stressColor(stressAvg);
  const stressPeak = data.stress.data.length
    ? Math.max(...data.stress.data.map(d => d.value))
    : stressAvg;

  const showSteps = data.stepsTimeline.some(sample => sample.steps > 0);

  return (
    <div className="lg:h-full min-h-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2 gap-3">
      <Tile
        icon={<Gauge size={14} style={{ color: recoveryColor }} />}
        title={t('trends.recovery')}
        extra={<span className="ml-auto text-[10px] font-semibold tracking-widest" style={{ color: recoveryColor }}>{recoveryLabel}</span>}
      >
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <CircularGauge score={data.recovery.score} size={118} strokeWidth={9} color={recoveryColor}>
            <span className="text-4xl font-black leading-none" style={{ color: recoveryColor }}>
              {data.recovery.score}
            </span>
          </CircularGauge>
        </div>
        <div className="shrink-0 grid grid-cols-3 gap-2 pt-1 text-center">
          <Mini label="HRV" value={`${data.recovery.hrv}`} unit="ms" color="#c084fc" />
          <Mini label={t('trends.rhr')} value={`${data.recovery.restingHR}`} unit="bpm" color="#38bdf8" />
          <Mini label={t('trends.sleep')} value={`${data.recovery.sleepScore}`} unit="%" color="#818cf8" />
        </div>
      </Tile>

      <Tile
        icon={<BatteryMedium size={14} className="text-battery" />}
        title={t('bodyBattery.title')}
        extra={<span className="ml-auto text-xl font-black leading-none" style={{ color: bb.isAvailable ? bbColor : '#737373' }}>{bb.isAvailable ? bb.current : '—'}</span>}
      >
        {bb.isAvailable ? (
          <>
            <div className="shrink-0 flex gap-3 text-[11px] mb-1">
              <span className="text-recovery-green">{t('bodyBattery.charged')} {bb.charged}</span>
              <span className="text-recovery-red">{t('bodyBattery.drained')} {bb.drained}</span>
            </div>
            <BodyBatteryTimeline battery={bb} stress={data.stress} sleep={data.sleep} />
          </>
        ) : (
          <p className="text-xs text-muted">{t('bodyBattery.unavailable')}</p>
        )}
      </Tile>

      <Tile
        icon={<Footprints size={14} className="text-battery" />}
        title={t('statsRow.steps')}
        extra={
          <span className="ml-auto flex items-baseline gap-3">
            <span className="text-xl font-black text-primary leading-none">{data.steps.toLocaleString(locale)}</span>
            {data.calories > 0 && (
              <span className="text-right leading-none">
                <span className="block text-[9px] text-muted tracking-widest">{t('statsRow.calories')}</span>
                <span className="text-sm font-bold text-strain">{data.calories.toLocaleString(locale)}</span>
              </span>
            )}
          </span>
        }
      >
        <div className="flex-1 min-h-0">
          {showSteps && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.stepsTimeline} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#737373', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <Tooltip
                  cursor={{ fill: '#38bdf814' }}
                  content={({ active, payload }) => {
                    const sample = payload?.[0]?.payload as StepSample | undefined;
                    if (!active || !sample) return null;
                    return (
                      <div className="rounded-md bg-surface border border-border px-2 py-1 text-xs">
                        <p className="text-secondary">{sample.period}</p>
                        <p className="font-semibold text-primary">{t('statsRow.periodSteps', { steps: sample.steps.toLocaleString(locale) })}</p>
                        <p className="text-[10px] text-battery">{t('statsRow.periodTotal', { total: sample.total.toLocaleString(locale) })}</p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="steps" fill="#38bdf8" radius={[2, 2, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Tile>

      <Tile
        icon={<Moon size={14} className="text-sleep" />}
        title={t('sleep.title')}
        extra={<span className="ml-auto text-xl font-black text-primary leading-none">{data.sleep.sleepScore}</span>}
      >
        <p className="shrink-0 text-sm font-semibold text-primary">{formatDuration(totalSleep)}</p>
        <div className="shrink-0 mt-2 h-1.5 rounded-full overflow-hidden flex bg-muted">
          {stages.map(stage => (
            <div
              key={stage.key}
              style={{
                width: totalSleep > 0 ? `${(stage.seconds / totalSleep) * 100}%` : '0%',
                backgroundColor: stage.color,
              }}
            />
          ))}
        </div>
        <div className="flex-1 min-h-0 flex items-end gap-1 mt-3">
          {sleepHours.map((hours, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
              <div
                className="w-full rounded-sm"
                style={{
                  height: `${Math.max(4, (hours / maxSleep) * 100)}%`,
                  backgroundColor: hours >= 7 ? '#4ade80' : hours >= 6 ? '#facc15' : '#f87171',
                  opacity: hours > 0 ? 1 : 0.25,
                }}
              />
              <span className="text-[9px] text-muted">{data.weeklyTrend.dates[i]}</span>
            </div>
          ))}
        </div>
      </Tile>

      <Tile
        icon={<Activity size={14} className="text-hrv" />}
        title="HRV"
        extra={<span className="ml-auto text-[10px] font-semibold" style={{ color: hrvColor }}>{hrvLabel}</span>}
      >
        <div className="shrink-0 flex items-end gap-2">
          <span className="text-3xl font-black leading-none text-hrv">{data.hrv.lastNight}</span>
          <span className="text-[11px] text-secondary mb-0.5">
            {t('common.avg7d')} {data.hrv.weeklyAverage} ms
          </span>
        </div>
        <div className="flex-1 min-h-0 mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={hrvSeries} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
              <Area type="monotone" dataKey="v" stroke="#c084fc" strokeWidth={1.5} fill="#c084fc" fillOpacity={0.15} dot={false} />
              <Tooltip
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as { v?: number; label?: string } | undefined;
                  if (!active || !point) return null;
                  return (
                    <div className="rounded-md bg-surface border border-border px-2 py-1 text-xs">
                      <span className="text-secondary mr-1">{point.label}</span>
                      <span className="text-hrv">{point.v} ms</span>
                    </div>
                  );
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Tile>

      <Tile
        icon={<Flame size={14} className="text-strain" />}
        title={t('strain.title')}
        extra={<span className="ml-auto text-xl font-black leading-none" style={{ color: strainColor }}>{data.strain.toFixed(1)}<span className="text-[10px] text-muted font-medium"> / 21</span></span>}
      >
        <div className="flex-1 min-h-0 flex items-end gap-1">
          {data.weeklyTrend.strain.map((value, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
              <div
                className="w-full rounded-sm"
                style={{
                  height: `${Math.max(4, (value / strainMax) * 100)}%`,
                  backgroundColor: getStrainColor(value),
                  opacity: value > 0 ? 1 : 0.25,
                }}
              />
              <span className="text-[9px] text-muted">{data.weeklyTrend.dates[i]}</span>
            </div>
          ))}
        </div>
      </Tile>

      <Tile
        icon={<Brain size={14} className="text-stress" />}
        title={t('stress.title')}
        extra={<span className="ml-auto text-xl font-black leading-none" style={{ color: stressTint }}>{stressAvg}</span>}
      >
        <div className="shrink-0 relative h-1.5 rounded-full mb-3" style={{ background: 'linear-gradient(to right, #4ade80, #facc15, #fb923c, #f87171)' }}>
          <div
            className="absolute top-1/2 w-2.5 h-2.5 rounded-full border-2 border-bg"
            style={{ left: `${stressAvg}%`, transform: 'translate(-50%, -50%)', backgroundColor: stressTint }}
          />
        </div>
        <div className="shrink-0 grid grid-cols-3 gap-2 text-center mb-2">
          <Mini label={t('stress.levels.peak')} value={`${stressPeak}`} color={stressColor(stressPeak)} />
          <Mini label={t('stress.levels.atRest')} value={`${data.stress.restingPercentage}%`} color="#4ade80" />
          <Mini
            label={t('stress.levels.tension')}
            value={`${data.stress.highStressPercentage}%`}
            color={data.stress.highStressPercentage > 40 ? '#f87171' : '#facc15'}
          />
        </div>
        <div className="flex-1 min-h-0">
          {data.stress.data.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.stress.data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <Area type="monotone" dataKey="value" stroke={stressTint} strokeWidth={1.5} fill={stressTint} fillOpacity={0.12} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Tile>

      <InsightsCard data={data} profile={profile} benchmarks={benchmarks} compact />
    </div>
  );
}

function Mini({ label, value, unit, color }: { label: string; value: string; unit?: string; color: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest text-muted">{label}</p>
      <p className="text-sm font-bold leading-tight" style={{ color }}>
        {value}
        {unit && <span className="text-[10px] font-medium text-secondary ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}
