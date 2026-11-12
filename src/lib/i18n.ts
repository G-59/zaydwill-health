'use client';

import { createContext, useContext, useEffect, createElement } from 'react';
import type { ReactNode } from 'react';
import en from '@/locales/en';

export type Locale = 'en';

function resolve(obj: Record<string, unknown>, key: string): string {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
    else return key;
  }
  return typeof cur === 'string' ? cur : key;
}

export function interpolate(
  str: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return str;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
    str,
  );
}

function resolveArr(obj: Record<string, unknown>, key: string): string[] {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
    else return [];
  }
  return Array.isArray(cur) ? cur.map(String) : [];
}

const messages = en as unknown as Record<string, unknown>;

interface LangContextType {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  tArr: (key: string) => string[];
}

const LangContext = createContext<LangContextType>({
  locale: 'en',
  t: (key, vars) => interpolate(resolve(messages, key) || key, vars),
  tArr: (key) => resolveArr(messages, key),
});

export function LangProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = 'en';
    localStorage.removeItem('garmin_lang');
  }, []);

  const value: LangContextType = {
    locale: 'en',
    t: (key, vars) => interpolate(resolve(messages, key) || key, vars),
    tArr: (key) => resolveArr(messages, key),
  };

  return createElement(LangContext.Provider, { value }, children);
}

export function useLang() {
  return useContext(LangContext);
}
