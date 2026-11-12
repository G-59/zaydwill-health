'use client';

import { useEffect, useState } from 'react';
import {
  Lightbulb, TrendingDown, TrendingUp, AlertTriangle,
  CheckCircle, Info, Zap, Moon, Battery, Brain, ChevronDown, ChevronUp,
} from 'lucide-react';
import type { DailyMetrics, UserProfile } from '@/lib/types';
import type { ProfileBenchmarks } from '@/lib/benchmarks';
import { format } from 'date-fns';
import { useInsightsHistory, analyzePatterns } from '@/lib/useInsightsHistory';
import type { InsightHistoryEntry } from '@/lib/useInsightsHistory';
import { useLang } from '@/lib/i18n';

// ── Types ─────────────────────────────────────────────────────────────────────

type InsightType = 'success' | 'warning' | 'danger' | 'info';

interface Insight {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Icon: React.ElementType<any>;
  text: string;
  subtext?: string;
  motivation: string;
  type: InsightType;
}

const STYLES: Record<InsightType, { color: string; bg: string; border: string }> = {
  success: { color: '#4ade80', bg: '#4ade8010', border: '#4ade8028' },
  warning: { color: '#facc15', bg: '#facc1510', border: '#facc1528' },
  danger:  { color: '#f87171', bg: '#f8717110', border: '#f8717128' },
  info:    { color: '#818cf8', bg: '#818cf810', border: '#818cf828' },
};

const DOT_COLOR: Record<InsightType, string> = {
  success: '#4ade80',
  warning: '#facc15',
  danger:  '#f87171',
  info:    '#818cf8',
};

const SEVERITY: Record<InsightType, number> = { danger: 0, warning: 1, success: 2, info: 3 };

// ── Rule engine ───────────────────────────────────────────────────────────────

type TFunc = (key: string, params?: Record<string, string | number>) => string;

function buildInsights(
  data: DailyMetrics,
  profile: UserProfile | null,
  t: TFunc,
): Insight[] {
  const pool: Insight[] = [];
  const sleepHours = Math.round((data.sleep.totalSleepSeconds / 3600) * 10) / 10;
  const todayStrain = data.activities.reduce((s, a) => s + a.strain, 0);

  // ── 1. Recovery summary (always) ────────────────────────────────────────────
  if (data.recovery.score >= 67) {
    pool.push({
      id: 'recovery',
      Icon: CheckCircle,
      type: 'success',
      text: t('insights.msgs.goodRecovery', { score: data.recovery.score }),
      subtext: profile?.goal === 'performance'
        ? t('insights.msgs.goodRecoveryDesc')
        : t('insights.msgs.goodRecoveryDesc2'),
      motivation: t('insights.msgs.goodRecoveryMotive'),
    });
  } else if (data.recovery.score >= 34) {
    pool.push({
      id: 'recovery',
      Icon: AlertTriangle,
      type: 'warning',
      text: t('insights.msgs.modRecovery', { score: data.recovery.score }),
      subtext: t('insights.msgs.modRecoveryDesc'),
      motivation: t('insights.msgs.modRecoveryMotive'),
    });
  } else {
    pool.push({
      id: 'recovery',
      Icon: AlertTriangle,
      type: 'danger',
      text: t('insights.msgs.lowRecovery', { score: data.recovery.score }),
      subtext: t('insights.msgs.lowRecoveryDesc'),
      motivation: t('insights.msgs.lowRecoveryMotive'),
    });
  }

  // ── 2. HRV vs weekly average ────────────────────────────────────────────────
  if (data.hrv.weeklyAverage > 0 && data.hrv.lastNight > 0) {
    const ratio = data.hrv.lastNight / data.hrv.weeklyAverage;
    if (ratio < 0.82) {
      const drop = Math.round((1 - ratio) * 100);
      pool.push({
        id: 'hrv_low',
        Icon: TrendingDown,
        type: 'warning',
        text: t('insights.msgs.hrvDrop', { hrv: data.hrv.lastNight, drop }),
        subtext: t('insights.msgs.hrvDropDesc'),
        motivation: t('insights.msgs.hrvDropMotive'),
      });
    } else if (ratio > 1.10) {
      const rise = Math.round((ratio - 1) * 100);
      pool.push({
        id: 'hrv_high',
        Icon: TrendingUp,
        type: 'success',
        text: t('insights.msgs.hrvRise', { hrv: data.hrv.lastNight, rise }),
        subtext: t('insights.msgs.hrvRiseDesc'),
        motivation: t('insights.msgs.hrvRiseMotive'),
      });
    }
  }

  // ── 3. Sleep duration ───────────────────────────────────────────────────────
  if (sleepHours < 6) {
    pool.push({
      id: 'sleep_low',
      Icon: Moon,
      type: 'danger',
      text: t('insights.msgs.sleepSevere', { hours: sleepHours }),
      subtext: t('insights.msgs.sleepSevereDesc'),
      motivation: t('insights.msgs.sleepSevereMotive'),
    });
  } else if (sleepHours < 6.5) {
    pool.push({
      id: 'sleep_short',
      Icon: Moon,
      type: 'warning',
      text: t('insights.msgs.sleepShort', { hours: sleepHours }),
      subtext: t('insights.msgs.sleepShortDesc'),
      motivation: t('insights.msgs.sleepShortMotive'),
    });
  }

  // ── 4. Body Battery ─────────────────────────────────────────────────────────
  if (data.bodyBattery.isAvailable) {
    if (data.bodyBattery.current < 25) {
      pool.push({
        id: 'battery_critical',
        Icon: Battery,
        type: 'danger',
        text: t('insights.msgs.batteryCritical', { battery: data.bodyBattery.current }),
        subtext: t('insights.msgs.batteryCriticalDesc'),
        motivation: t('insights.msgs.batteryCriticalMotive'),
      });
    } else if (data.bodyBattery.current < 40) {
      pool.push({
        id: 'battery_low',
        Icon: Battery,
        type: 'warning',
        text: t('insights.msgs.batteryLow', { battery: data.bodyBattery.current }),
        subtext: t('insights.msgs.batteryLowDesc'),
        motivation: t('insights.msgs.batteryLowMotive'),
      });
    }
  }

  // ── 5. Stress load ──────────────────────────────────────────────────────────
  if (data.stress.highStressPercentage > 50) {
    pool.push({
      id: 'stress_high',
      Icon: Brain,
      type: 'warning',
      text: t('insights.msgs.stressHigh', { pct: data.stress.highStressPercentage }),
      subtext: t('insights.msgs.stressHighDesc'),
      motivation: t('insights.msgs.stressHighMotive'),
    });
  } else if (data.stress.average > 60 && data.stress.highStressPercentage <= 50) {
    pool.push({
      id: 'stress_avg',
      Icon: Brain,
      type: 'info',
      text: t('insights.msgs.stressAvg', { avg: data.stress.average }),
      subtext: t('insights.msgs.stressAvgDesc'),
      motivation: t('insights.msgs.stressAvgMotive'),
    });
  }

  // ── 6. Weekly recovery decline ──────────────────────────────────────────────
  const recTrend = data.weeklyTrend.recovery.filter(v => v > 0);
  if (recTrend.length >= 3) {
    const last3 = recTrend.slice(-3);
    if (last3[0] > last3[1] && last3[1] > last3[2]) {
      pool.push({
        id: 'trend_down',
        Icon: TrendingDown,
        type: 'warning',
        text: t('insights.msgs.fatigue'),
        subtext: t('insights.msgs.fatigueDesc'),
        motivation: t('insights.msgs.fatigueMotive'),
      });
    }
  }

  // ── 7. Goal-specific tips ───────────────────────────────────────────────────
  if (profile?.goal === 'weight_loss' && data.steps < 6000) {
    pool.push({
      id: 'steps_goal',
      Icon: Zap,
      type: 'info',
      text: t('insights.msgs.steps', { steps: data.steps.toLocaleString() }),
      subtext: t('insights.msgs.stepsDesc'),
      motivation: t('insights.msgs.stepsMotive'),
    });
  }

  if (profile?.goal === 'performance' && data.recovery.score >= 67 && todayStrain < 5) {
    pool.push({
      id: 'perf_ready',
      Icon: Zap,
      type: 'success',
      text: t('insights.msgs.perfectDay'),
      subtext: t('insights.msgs.perfectDayDesc'),
      motivation: t('insights.msgs.perfectDayMotive'),
    });
  }

  if (profile?.goal === 'recovery' && data.recovery.score < 34) {
    pool.push({
      id: 'goal_recovery',
      Icon: Info,
      type: 'info',
      text: t('insights.msgs.recoveryDay'),
      subtext: t('insights.msgs.recoveryDayDesc'),
      motivation: t('insights.msgs.recoveryDayMotive'),
    });
  }

  // ── Prioritize: recovery first, then by severity ────────────────────────────
  const [first, ...rest] = pool;
  const sorted = [first, ...rest.sort((a, b) => SEVERITY[a.type] - SEVERITY[b.type])];
  return sorted.slice(0, 3);
}

// ── History dot timeline ───────────────────────────────────────────────────────

function HistoryTimeline({ entries, t }: { entries: InsightHistoryEntry[]; t: TFunc }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  // build last 14 days slots
  const slots = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const dateStr = format(d, 'yyyy-MM-dd');
    const entry = entries.find(e => e.date === dateStr);
    const isToday = dateStr === today;
    return { dateStr, entry, isToday, dayLabel: format(d, 'd') };
  });

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <p className="text-[10px] text-muted uppercase tracking-widest mb-2">{t('insights.recoveryHistory')}</p>
      <div className="flex gap-1 items-end">
        {slots.map(({ dateStr, entry, isToday, dayLabel }) => (
          <div key={dateStr} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full rounded-full"
              style={{
                height: 8,
                backgroundColor: entry
                  ? DOT_COLOR[entry.worstType]
                  : isToday ? '#333' : '#1f1f1f',
                opacity: entry ? 1 : isToday ? 0.6 : 0.3,
              }}
              title={entry
                ? `${dateStr}: ${t('insights.tooltipRecovery')} ${entry.recovery}%, ${t('insights.tooltipSleep')} ${entry.sleepHours.toFixed(1)}h`
                : dateStr}
            />
            {isToday && (
              <span className="text-[8px] text-muted leading-none">{dayLabel}</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 flex-wrap">
        {(['success', 'warning', 'danger'] as InsightType[]).map(type => (
          <div key={type} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: DOT_COLOR[type] }} />
            <span className="text-[10px] text-muted">
              {type === 'success' ? t('insights.good') : type === 'warning' ? t('insights.moderate') : t('insights.low')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  data: DailyMetrics;
  profile: UserProfile | null;
  benchmarks: ProfileBenchmarks | null;
  /** Fill a fixed tile and scroll inside it, so the page itself stays put. */
  compact?: boolean;
}

export default function InsightsCard({ data, profile, compact = false }: Props) {
  const { t } = useLang();
  const insights = buildInsights(data, profile, t);
  const { entries, saveToday, loaded } = useInsightsHistory();
  const [showHistory, setShowHistory] = useState(false);

  // Save today's insights once data is ready
  useEffect(() => {
    if (!loaded || insights.length === 0) return;
    const sleepHours = data.sleep.totalSleepSeconds / 3600;
    saveToday(
      insights.map(i => i.id),
      insights.map(i => i.type),
      data.recovery.score,
      sleepHours,
      data.hrv.lastNight,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (insights.length === 0) return null;

  const patterns = analyzePatterns(entries);
  const hasHistory = entries.length >= 2;

  return (
    <div className={`card flex flex-col min-h-0 ${compact ? 'h-full overflow-hidden !p-3' : ''}`}>
      <div className={`card-header ${compact ? '!mb-2' : 'mb-3'}`}>
        <Lightbulb size={14} className="text-secondary" />
        <span>{t('insights.title')}</span>
        <span className="ml-auto text-[10px] text-muted">{t('insights.recommendations', { count: insights.length })}</span>
      </div>

      <div className={`flex flex-col gap-2 ${compact ? 'flex-1 min-h-0 overflow-y-auto pr-0.5' : ''}`}>
        {insights.map(({ id, Icon, type, text, subtext, motivation }) => {
          const s = STYLES[type];
          return (
            <div
              key={id}
              className="flex gap-3 rounded-xl px-3 py-2.5 border"
              style={{ backgroundColor: s.bg, borderColor: s.border }}
            >
              <div className="mt-0.5 flex-shrink-0">
                <Icon size={14} style={{ color: s.color }} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-primary leading-snug">{text}</p>
                {subtext && (
                  <p className="text-[11px] text-secondary mt-0.5 leading-snug">{subtext}</p>
                )}
                <p className="text-[11px] font-medium mt-1 leading-snug" style={{ color: s.color }}>
                  {motivation}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pattern summary */}
      {patterns.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border flex flex-col gap-1.5">
          {patterns.map((p, i) => (
            <div key={i} className="flex gap-2 items-start">
              <Info size={11} className="text-muted mt-0.5 flex-shrink-0" />
              <p className="text-[11px] text-secondary leading-snug">{p}</p>
            </div>
          ))}
        </div>
      )}

      {/* History toggle */}
      {hasHistory && (
        <button
          onClick={() => setShowHistory(v => !v)}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-primary transition-colors mt-3 pt-3 border-t border-border w-full"
        >
          {showHistory ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {t('insights.recoveryHistory')}
          <span className="ml-auto text-[10px]">{t('insights.days', { count: entries.length })}</span>
        </button>
      )}

      {showHistory && <HistoryTimeline entries={entries} t={t} />}
    </div>
  );
}
