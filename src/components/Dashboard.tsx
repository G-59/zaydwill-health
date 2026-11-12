'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';
import { RefreshCw, WifiOff, Gauge, User } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import type { DailyMetrics, TrendPoint } from '@/lib/types';
import { checkAndNotifyBattery } from '@/lib/notifications';
import { useProfile } from '@/lib/useProfile';
import { computeBenchmarks } from '@/lib/benchmarks';
import type { ProfileBenchmarks } from '@/lib/benchmarks';
import ProfileSetupModal from './ProfileSetupModal';
import OverviewBoard from './OverviewBoard';
import SectionNav from './SectionNav';
import SleepSection from './sections/SleepSection';
import HRVSection from './sections/HRVSection';
import StrainSection from './sections/StrainSection';
import StressSection from './sections/StressSection';
import TrendsSection from './sections/TrendsSection';
import ProfileSection from './sections/ProfileSection';
import WeightSection from './sections/WeightSection';
import NutritionSection from './sections/NutritionSection';

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-surface rounded-2xl ${className ?? ''}`} />
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DailyMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const [trends, setTrends] = useState<TrendPoint[] | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [section, setSection] = useState('overview');
  const frameRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [board, setBoard] = useState('100%');

  const { profile, saveProfile, clearProfile, loaded: profileLoaded } = useProfile();
  const showSetup = profileLoaded && !profile;

  const { t } = useLang();

  // Date string must be client-only to avoid server/client hydration mismatch
  const [dateStr, setDateStr] = useState('');
  useEffect(() => {
    setDateStr(format(new Date(), 'EEEE, MMMM d', { locale: enUS }));
    const fromHash = () => {
      const id = window.location.hash.replace('#', '');
      if (['overview', 'sleep', 'hrv', 'strain', 'stress', 'trends', 'weight', 'nutrition', 'profile'].includes(id)) {
        setSection(id);
      }
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  const selectSection = (id: string) => {
    setSection(id);
    const next = `#${id}`;
    if (window.location.hash !== next) history.replaceState(null, '', next);
  };

  // Keep the column as wide as two square rows, so the 4×2 overview stays even.
  useEffect(() => {
    const frame = frameRef.current;
    const header = headerRef.current;
    if (!frame || !header) return;
    const apply = () => {
      const wide = frame.clientWidth >= 1024;
      const next = (() => {
        if (!wide) return '100%';
        const gap = 12;
        const padX = 32;
        const padY = 24;
        const mainH = frame.clientHeight - header.offsetHeight - padY;
        const side = Math.max(0, (mainH - gap) / 2);
        return `${Math.min(frame.clientWidth, Math.round(side * 4 + gap * 3 + padX))}px`;
      })();
      setBoard(prev => (prev === next ? prev : next));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(frame);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Pass local date so the server doesn't use UTC (which can be a day ahead)
      const localDate = format(new Date(), 'yyyy-MM-dd');
      const res = await fetch(`/api/health?date=${localDate}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DailyMetrics = await res.json();
      setData(json);
      setLastSync(new Date());
      // Cache fitness metrics for profile page (VO2max + training zones)
      if (json.recovery?.restingHR > 0) {
        localStorage.setItem('garmin_last_rhr', String(json.recovery.restingHR));
      }
      const observedMax = json.activities?.reduce((m: number, a: { maxHR: number }) => Math.max(m, a.maxHR ?? 0), 0);
      if (observedMax > 100) {
        localStorage.setItem('garmin_observed_max_hr', String(observedMax));
      }
      // Check Body Battery alert threshold (no-op if notifications are disabled)
      if (json.bodyBattery?.isAvailable) {
        checkAndNotifyBattery(json.bodyBattery.current);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dashboard.error'));
    } finally {
      setLoading(false);
    }
  }, []);

  // 30-day history shared by the HRV and Strain sections
  useEffect(() => {
    const localDate = format(new Date(), 'yyyy-MM-dd');
    fetch(`/api/trends?range=30&date=${localDate}`)
      .then(r => r.json())
      .then((pts: TrendPoint[]) => setTrends(pts.length > 0 ? pts : null))
      .catch(() => setTrends(null))
      .finally(() => setTrendsLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
    // Auto-refresh every 15 minutes
    const interval = setInterval(fetchData, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const greeting = profile?.name ? t('dashboard.hello', { name: profile.name }) : t('dashboard.title');

  // Compute age/sex/fitness benchmarks whenever we have both profile and data
  const benchmarks: ProfileBenchmarks | null =
    profile && data && data.hrv.weeklyAverage > 0 && data.recovery.restingHR > 0
      ? computeBenchmarks(profile, {
          hrv: data.hrv.weeklyAverage,
          rhr: data.recovery.restingHR,
          sleepHours: data.sleep.totalSleepSeconds / 3600,
        })
      : null;

  return (
    <>
      {/* First-time setup modal */}
      {showSetup && (
        <ProfileSetupModal onComplete={saveProfile} />
      )}

      <div ref={frameRef} className="h-full overflow-hidden bg-bg flex flex-col" style={{ ['--board' as string]: board }}>
        {/* Header */}
        <header ref={headerRef} className="w-[var(--board)] max-w-full mx-auto shrink-0 z-40 bg-bg/95 backdrop-blur border-b border-border">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge size={18} className="text-primary" />
              <div>
                <h1 className="text-sm font-bold text-primary leading-none">{greeting}</h1>
                <p className="text-[10px] text-secondary capitalize mt-0.5">
                  {dateStr}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {data?.isDemo && data.demoReason !== 'login_failed' && data.demoReason !== 'fetch_error' && data.demoReason !== 'rate_limited' && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
                  {t('common.demo')}
                </span>
              )}
              {data?.isDemo && data.demoReason === 'rate_limited' && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-400/10 text-orange-400 border border-orange-400/20">
                  {t('common.garminRateLimited')}
                </span>
              )}
              {data?.isDemo && (data.demoReason === 'login_failed' || data.demoReason === 'fetch_error') && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-400/10 text-orange-400 border border-orange-400/20">
                  {t('common.garminUnavailable')}
                </span>
              )}
              {lastSync && (
                <span className="text-[10px] text-muted">
                  {format(lastSync, 'HH:mm')}
                </span>
              )}
              <button
                onClick={fetchData}
                disabled={loading}
                className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface transition-colors disabled:opacity-40"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
              {/* Profile link */}
              <a
                href="#profile"
                className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface transition-colors"
              >
                {profile ? (
                  <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                    <span className="text-[9px] font-bold text-primary">
                      {(profile.name ?? (profile.sex === 'male' ? 'H' : 'M'))[0].toUpperCase()}
                    </span>
                  </div>
                ) : (
                  <User size={15} />
                )}
              </a>
            </div>
          </div>
          <SectionNav active={section} onSelect={selectSection} />
        </header>

        {/* Main content — overview fills the screen; other sections scroll inside this pane */}
        <main className="flex-1 min-h-0 w-[var(--board)] max-w-full mx-auto px-4 pb-3 pt-3 flex flex-col">
          {/* Error state */}
          {error && (
            <div className="card flex items-center gap-3 mb-4 border-red-400/20">
              <WifiOff size={16} className="text-recovery-red flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-recovery-red">{t('dashboard.error')}</p>
                <p className="text-xs text-secondary">{error}</p>
              </div>
              <button
                onClick={fetchData}
                className="ml-auto text-xs text-primary underline"
              >
                {t('common.retry')}
              </button>
            </div>
          )}

          {/* Loading skeletons */}
          {loading && !data && (
            <div className="flex-1 min-h-0 grid grid-cols-2 lg:grid-cols-4 lg:grid-rows-2 gap-3">
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-full min-h-[160px]" />)}
            </div>
          )}

          {data && section === 'overview' && (
            <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden animate-fade-up">
              <OverviewBoard data={data} profile={profile} benchmarks={benchmarks} />
            </div>
          )}

          {data && section !== 'overview' && (
            <div className="flex-1 min-h-0 overflow-y-auto animate-fade-up">
              {section === 'sleep' && <SleepSection data={data} />}
              {section === 'hrv' && <HRVSection data={data} trends={trends} trendsLoading={trendsLoading} profile={profile} />}
              {section === 'strain' && <StrainSection data={data} trends={trends} />}
              {section === 'stress' && <StressSection data={data} />}
              {section === 'trends' && <TrendsSection data={data} profile={profile} />}
              {section === 'weight' && <WeightSection />}
              {section === 'nutrition' && <NutritionSection />}
              {section === 'profile' && (
                <ProfileSection
                  profile={profile}
                  saveProfile={saveProfile}
                  clearProfile={clearProfile}
                  currentBattery={data.bodyBattery.current}
                />
              )}

              <div className="text-center text-[10px] text-muted py-4">
                {data.isDemo && data.demoReason === 'no_credentials' ? (
                  <span>{t('dashboard.demoBadge')}</span>
                ) : data.isDemo && data.demoReason === 'rate_limited' ? (
                  <span>{t('dashboard.garminRateLimitedBadge')}</span>
                ) : data.isDemo && (data.demoReason === 'login_failed' || data.demoReason === 'fetch_error') ? (
                  <span>{t('dashboard.garminUnavailableBadge')}</span>
                ) : (
                  <span>{t('dashboard.dataDate', { date: data.date })}</span>
                )}
              </div>
            </div>
          )}
        </main>

      </div>
    </>
  );
}
