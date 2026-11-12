'use client';

import { useEffect, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Utensils } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import type { MacroLine, NutritionDay } from '@/lib/types';
import SectionShell from './SectionShell';

function Ring({
  segments,
  center,
  label,
}: {
  segments: { value: number; color: string }[];
  center: string;
  label: string;
}) {
  const total = segments.reduce((sum, segment) => sum + Math.max(segment.value, 0), 0);
  let cursor = 0;
  const stops = total <= 0
    ? '#262626 0 100%'
    : segments.map(segment => {
      const start = cursor;
      cursor += (Math.max(segment.value, 0) / total) * 100;
      return `${segment.color} ${start}% ${cursor}%`;
    }).join(', ');

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative h-28 w-28 rounded-full"
        style={{ background: `conic-gradient(${stops})` }}
      >
        <div className="absolute inset-2 flex flex-col items-center justify-center rounded-full bg-[#141414]">
          <span className="text-lg font-black leading-none text-primary">{center}</span>
          <span className="text-[10px] text-muted mt-0.5">kcal</span>
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-widest text-muted">{label}</span>
    </div>
  );
}

function MacroBar({
  label, line, color, unit,
}: {
  label: string;
  line: MacroLine;
  color: string;
  unit: string;
}) {
  const pct = line.target && line.target > 0 ? Math.round((line.consumed / line.target) * 100) : null;
  const width = pct == null ? 0 : Math.min(pct, 100);
  return (
    <div>
      <div className="flex items-baseline gap-2 text-xs">
        <span className="text-primary font-medium">{label}</span>
        <span className="text-secondary">
          {line.consumed.toFixed(unit === 'kcal' ? 0 : 1)}
          {line.target != null ? ` / ${line.target.toFixed(unit === 'kcal' ? 0 : 1)}` : ''} {unit}
        </span>
        {pct != null && <span className="ml-auto text-secondary">{pct}%</span>}
      </div>
      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </div>
    </div>
  );
}

export default function NutritionSection() {
  const { t } = useLang();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [date, setDate] = useState(today);
  const [day, setDay] = useState<NutritionDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    fetch(`/api/nutrition?date=${date}`)
      .then(async res => {
        const body = await res.json() as NutritionDay & { error?: string };
        if (!res.ok) throw new Error(body.error ?? 'request_failed');
        return body;
      })
      .then(body => {
        if (!cancel) setDay(body);
      })
      .catch((err: Error) => {
        if (!cancel) {
          setDay(null);
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => { cancel = true; };
  }, [date]);

  const shift = (by: number) => {
    const next = format(addDays(parseISO(date), by), 'yyyy-MM-dd');
    if (next <= today) setDate(next);
  };

  const proteinKcal = (day?.protein.consumed ?? 0) * 4;
  const carbKcal = (day?.netCarbs.consumed ?? 0) * 4;
  const fatKcal = (day?.fat.consumed ?? 0) * 9;

  return (
    <SectionShell
      id="nutrition"
      title={t('nutrition.title')}
      icon={<Utensils size={16} className="text-strain" />}
      center={
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('nutrition.previousDay')}
            onClick={() => shift(-1)}
            className="p-1 rounded-full border border-border text-secondary hover:text-primary"
          >
            <ChevronLeft size={14} />
          </button>
          <div className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-primary min-w-[7.5rem] text-center">
            {date === today ? t('nutrition.today') : format(parseISO(date), 'MMM d', { locale: enUS })}
          </div>
          <button
            type="button"
            aria-label={t('nutrition.nextDay')}
            disabled={date >= today}
            onClick={() => shift(1)}
            className="p-1 rounded-full border border-border text-secondary hover:text-primary disabled:opacity-30"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      }
    >
      <div className="col-span-full">
        {loading && <div className="card text-xs text-muted">{t('nutrition.loading')}</div>}
        {!loading && error === 'missing_credentials' && (
          <div className="card text-xs text-secondary leading-relaxed">{t('nutrition.needsLogin')}</div>
        )}
        {!loading && error === 'totp_required' && (
          <div className="card text-xs text-secondary leading-relaxed">{t('nutrition.needsTotp')}</div>
        )}
        {!loading && error === 'rate_limited' && (
          <div className="card text-xs text-secondary leading-relaxed">{t('nutrition.rateLimited')}</div>
        )}
        {!loading && error === 'login_failed' && (
          <div className="card text-xs text-secondary leading-relaxed">{t('nutrition.badLogin')}</div>
        )}
        {!loading && error && !['missing_credentials', 'totp_required', 'rate_limited', 'login_failed'].includes(error) && (
          <div className="card text-xs text-secondary">{t('nutrition.failed')}</div>
        )}
        {!loading && day && (
          <div className="card">
            <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-8 items-center">
              <div className="flex items-start justify-around gap-4">
                <Ring
                  label={t('nutrition.consumed')}
                  center={day.consumed.toLocaleString()}
                  segments={[
                    { value: proteinKcal, color: '#4ade80' },
                    { value: carbKcal, color: '#22d3ee' },
                    { value: fatKcal, color: '#c084fc' },
                  ]}
                />
                <Ring
                  label={t('nutrition.expenditure')}
                  center={day.burned == null ? '—' : day.burned.toLocaleString()}
                  segments={[{ value: day.burned ?? 0, color: '#c084fc' }, { value: day.burned == null ? 1 : 0, color: '#333' }]}
                />
                <Ring
                  label={t('nutrition.remaining')}
                  center={day.remaining == null ? '—' : day.remaining.toLocaleString()}
                  segments={[
                    { value: Math.max(day.remaining ?? 0, 0), color: '#fb923c' },
                    { value: Math.max((day.target ?? 0) - Math.max(day.remaining ?? 0, 0), 0), color: '#333' },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-4">
                <MacroBar
                  label={t('nutrition.energy')}
                  color="#fb923c"
                  unit="kcal"
                  line={{
                    consumed: day.consumed,
                    target: day.target,
                  }}
                />
                {day.net != null && (
                  <p className="text-[10px] text-muted -mt-2">
                    {t('nutrition.net', { net: day.net.toLocaleString() })}
                  </p>
                )}
                <MacroBar label={t('nutrition.protein')} color="#4ade80" unit="g" line={day.protein} />
                <MacroBar label={t('nutrition.netCarbs')} color="#22d3ee" unit="g" line={day.netCarbs} />
                <MacroBar label={t('nutrition.fat')} color="#c084fc" unit="g" line={day.fat} />
              </div>
            </div>
          </div>
        )}
      </div>
    </SectionShell>
  );
}
