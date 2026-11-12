'use client';

import { clsx } from 'clsx';
import { LayoutDashboard, Moon, Activity, Flame, Brain, TrendingUp, Scale, Utensils, User } from 'lucide-react';
import { useLang } from '@/lib/i18n';

const SECTIONS = [
  { id: 'overview', key: 'nav.overview', Icon: LayoutDashboard },
  { id: 'sleep',    key: 'nav.sleep',    Icon: Moon },
  { id: 'hrv',      key: 'nav.hrv',      Icon: Activity },
  { id: 'strain',   key: 'nav.strain',   Icon: Flame },
  { id: 'stress',   key: 'nav.stress',   Icon: Brain },
  { id: 'trends',   key: 'nav.trends',   Icon: TrendingUp },
  { id: 'weight',    key: 'nav.weight',    Icon: Scale },
  { id: 'nutrition', key: 'nav.nutrition', Icon: Utensils },
  { id: 'profile',   key: 'nav.profile',   Icon: User },
] as const;

interface Props {
  active: string;
  onSelect: (id: string) => void;
}

/** Switches the visible section. The page stays in place instead of scrolling. */
export default function SectionNav({ active, onSelect }: Props) {
  const { t } = useLang();

  return (
    <nav className="w-full px-4 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
      {SECTIONS.map(({ id, key, Icon }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={clsx(
            'flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
            active === id
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'border-border text-secondary hover:text-primary',
          )}
        >
          <Icon size={13} />
          {t(key)}
        </button>
      ))}
    </nav>
  );
}
