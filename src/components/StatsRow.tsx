'use client';

import { Footprints, Flame } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { useLang } from '@/lib/i18n';
import type { StepSample } from '@/lib/types';

interface Props {
  steps: number;
  calories: number;
  stepsTimeline?: StepSample[];
}

export default function StatsRow({ steps, calories, stepsTimeline = [] }: Props) {
  const { t, locale } = useLang();
  if (!steps && !calories) return null;
  const showChart = steps > 0 && stepsTimeline.some(sample => sample.steps > 0);
  return (
    <div className="flex gap-3">
      {steps > 0 && (
        <div className={`card flex-1 ${showChart ? '' : 'flex items-center gap-3 py-3'}`}>
          <div className={`flex items-center gap-3 ${showChart ? 'mb-3' : ''}`}>
            <Footprints size={18} className="text-battery flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] text-secondary uppercase tracking-widest">{t('statsRow.steps')}</p>
              <p className="text-xl font-black text-primary">{steps.toLocaleString(locale)}</p>
            </div>
            {showChart && (
              <span className="ml-auto text-[10px] text-muted uppercase tracking-widest">
                {t('statsRow.hourly')}
              </span>
            )}
          </div>
          {showChart && (
            <ResponsiveContainer width="100%" height={96}>
              <BarChart data={stepsTimeline} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#737373', fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={28}
                />
                <Tooltip
                  cursor={{ fill: '#38bdf814' }}
                  content={({ active, payload }) => {
                    const sample = payload?.[0]?.payload as StepSample | undefined;
                    if (!active || !sample) return null;
                    return (
                      <div className="rounded-md bg-surface border border-border px-2 py-1 text-xs">
                        <p className="text-secondary">{sample.period}</p>
                        <p className="font-semibold text-primary">
                          {t('statsRow.periodSteps', { steps: sample.steps.toLocaleString(locale) })}
                        </p>
                        <p className="text-[10px] text-battery">
                          {t('statsRow.periodTotal', { total: sample.total.toLocaleString(locale) })}
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="steps" fill="#38bdf8" radius={[3, 3, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
      {calories > 0 && (
        <div className="card flex-1 flex items-center gap-3 py-3">
          <Flame size={18} className="text-strain flex-shrink-0" />
          <div>
            <p className="text-[10px] text-secondary uppercase tracking-widest">{t('statsRow.calories')}</p>
            <p className="text-xl font-black text-primary">{calories.toLocaleString(locale)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
