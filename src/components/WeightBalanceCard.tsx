'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { assessWeek, bodyWaterGuide, hydrationCaution, type BalanceStatus } from '@/lib/weightBalance';
import { useProfile } from '@/lib/useProfile';
import type { ScaleReading } from '@/lib/types';

const TONE: Record<BalanceStatus, string> = {
  maintenance: '#4ade80',
  surplus: '#fb923c',
  deficit: '#38bdf8',
};

interface Result {
  status: BalanceStatus;
  note: string;
  source: 'ai' | 'trend';
}

function signatureOf(readings: ScaleReading[]) {
  return readings.map(reading => (
    `${reading.date}|${reading.weightKg}|${reading.bodyFat ?? ''}|${reading.muscleKg ?? ''}|${reading.bodyWater ?? ''}`
  )).join(';');
}

export default function WeightBalanceCard({ readings }: { readings: ScaleReading[] }) {
  const { t } = useLang();
  const { profile } = useProfile();
  const guide = bodyWaterGuide(profile?.sex);
  const signature = useMemo(() => signatureOf(readings), [readings]);
  const trend = useMemo(() => assessWeek(readings), [readings]);
  const caution = useMemo(() => hydrationCaution(readings), [readings]);
  const currentWater = useMemo(() => {
    const ordered = [...readings].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    for (let i = ordered.length - 1; i >= 0; i--) {
      const value = ordered[i].bodyWater;
      if (value != null) return value;
    }
    return null;
  }, [readings]);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    const cached = sessionStorage.getItem(`weight_balance_v5_${signature}`);
    if (cached) {
      try {
        setResult(JSON.parse(cached) as Result);
        setPending(false);
        return;
      } catch { /* refetch */ }
    }

    let cancel = false;
    setPending(true);
    fetch('/api/weight-balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readings: readings.map(reading => ({
          date: reading.date,
          time: reading.time,
          weightKg: reading.weightKg,
          bodyFat: reading.bodyFat,
          muscleKg: reading.muscleKg,
          bodyWater: reading.bodyWater,
          bmi: reading.bmi,
          boneKg: reading.boneKg,
          visceralFat: reading.visceralFat,
        })),
      }),
    })
      .then(res => res.ok ? res.json() as Promise<Result> : Promise.reject(new Error(String(res.status))))
      .then(json => {
        if (cancel || !json?.status || !json.note) return;
        const next = { status: json.status, note: json.note, source: json.source === 'ai' ? 'ai' as const : 'trend' as const };
        sessionStorage.setItem(`weight_balance_v5_${signature}`, JSON.stringify(next));
        setResult(next);
      })
      .catch(() => {
        if (!cancel && trend) setResult({ status: trend.status, note: trend.note, source: 'trend' });
      })
      .finally(() => {
        if (!cancel) setPending(false);
      });

    return () => { cancel = true; };
  }, [signature, readings, trend]);

  const shown = result ?? (trend ? { status: trend.status, note: trend.note, source: 'trend' as const } : null);
  if (!shown) return null;

  return (
    <div className="card !p-3">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-purple-400" />
        <span className="text-[10px] uppercase tracking-widest text-muted">{t('weightLog.balanceTitle')}</span>
        <span
          className="ml-auto text-[10px] font-semibold tracking-widest px-2 py-0.5 rounded-full border"
          style={{ color: TONE[shown.status], borderColor: `${TONE[shown.status]}55` }}
        >
          {t(`weightLog.balance.${shown.status}`)}
        </span>
      </div>
      <p className="text-xs text-secondary mt-2 leading-relaxed">
        {pending && !result ? t('weightLog.balanceLoading') : shown.note}
      </p>
      <p className="text-[10px] text-muted mt-1.5">{t('weightLog.balanceHint')}</p>
      {caution && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2.5">
          <AlertTriangle size={18} className="text-amber-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-amber-400">{t('weightLog.hydrateTitle')}</p>
            <p className="text-xs text-primary mt-1 leading-relaxed">
              {t('weightLog.hydrateDetail', { drop: caution.drop, low: caution.low })}
            </p>
          </div>
          {currentWater != null && (
            <div className="shrink-0 text-right pl-2">
              <p className="text-[10px] uppercase tracking-widest text-amber-400/80">{t('weightLog.water')}</p>
              <p className="text-2xl font-black leading-none mt-1 text-amber-400">
                {currentWater.toFixed(1)}
                <span className="text-xs font-medium text-amber-400/80 ml-1">%</span>
              </p>
              <p className="text-[10px] text-amber-400/80 mt-1">{t('weightLog.hydrateRange', { low: guide.low, high: guide.high })}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
