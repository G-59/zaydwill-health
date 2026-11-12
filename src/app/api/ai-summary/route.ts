import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface WeeklyPayload {
  recovery:   number[];   // 0-100, 7 values
  hrv:        number[];   // ms
  sleepHours: number[];   // h
  rhr:        number[];   // bpm
  strain:     number[];   // 0-21
  profile?: {
    age?:          number;
    sex?:          string;
    fitnessLevel?: string;
    goal?:         string;
  };
}

function avg(arr: number[]): number {
  const v = arr.filter(x => x > 0);
  if (!v.length) return 0;
  return Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10;
}

function minVal(arr: number[]): number {
  const v = arr.filter(x => x > 0);
  return v.length ? Math.round(Math.min(...v) * 10) / 10 : 0;
}

function maxVal(arr: number[]): number {
  const v = arr.filter(x => x > 0);
  return v.length ? Math.round(Math.max(...v) * 10) / 10 : 0;
}

function trendLabel(arr: number[]): string {
  const v = arr.filter(x => x > 0);
  if (v.length < 3) return 'stable';
  const first = v.slice(0, Math.ceil(v.length / 2));
  const last  = v.slice(Math.floor(v.length / 2));
  const aFirst = first.reduce((s, x) => s + x, 0) / first.length;
  const aLast  = last.reduce((s, x) => s + x, 0) / last.length;
  const pct = ((aLast - aFirst) / aFirst) * 100;
  if (pct > 5)  return 'rising';
  if (pct < -5) return 'falling';
  return 'stable';
}

const FITNESS_EN: Record<string, string> = {
  beginner: 'beginner', intermediate: 'intermediate',
  advanced: 'advanced', athlete: 'athlete',
};
const GOAL_EN: Record<string, string> = {
  recovery: 'recovery', performance: 'performance',
  weight_loss: 'weight loss', general_health: 'general health',
};

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured' },
      { status: 503 },
    );
  }

  let body: WeeklyPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { recovery, hrv, sleepHours, rhr, strain, profile } = body;

  const avgRec    = avg(recovery);
  const avgHrv    = avg(hrv);
  const avgSleep  = avg(sleepHours);
  const avgRhr    = avg(rhr);
  const avgStrain = avg(strain);

  const lines: string[] = [
    `Average recovery: ${avgRec}% (min ${minVal(recovery)}%, max ${maxVal(recovery)}%, trend ${trendLabel(recovery)})`,
    `Average HRV: ${avgHrv} ms (trend ${trendLabel(hrv)})`,
    `Sleep: ${avgSleep}h/night (min ${minVal(sleepHours)}h, max ${maxVal(sleepHours)}h)`,
    `Average resting HR: ${avgRhr} bpm (trend ${trendLabel(rhr)})`,
    `Average strain: ${avgStrain}/21`,
  ];

  if (profile) {
    const parts: string[] = [];
    if (profile.age)          parts.push(`${profile.age} years old`);
    if (profile.sex)          parts.push(profile.sex === 'male' ? 'male' : 'female');
    if (profile.fitnessLevel) parts.push(`${FITNESS_EN[profile.fitnessLevel] ?? profile.fitnessLevel} fitness`);
    if (profile.goal)         parts.push(`${GOAL_EN[profile.goal] ?? profile.goal} goal`);
    if (parts.length) lines.push(`Profile: ${parts.join(', ')}`);
  }

  const prompt = `You are a health and recovery coach. Analyze the following week of Garmin data and write a personalized summary in English. Use exactly 3-4 sentences (110 words max), be specific with the numbers, stay positive but honest, and end with 1 practical recommendation for the next few days. No lists or bullets, one paragraph only.

Week data:
${lines.join('\n')}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[ai-summary] Anthropic error:', err);
      return NextResponse.json({ error: 'Anthropic API error' }, { status: 502 });
    }

    const data = await response.json();
    const text: string = data.content?.[0]?.text ?? '';
    return NextResponse.json({ summary: text });
  } catch (err) {
    console.error('[ai-summary] fetch error:', err);
    return NextResponse.json({ error: 'Network error' }, { status: 502 });
  }
}
