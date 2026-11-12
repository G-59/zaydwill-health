import { NextResponse } from 'next/server';
import { assessWeek, type BalanceStatus } from '@/lib/weightBalance';
import type { ScaleReading } from '@/lib/types';

export const runtime = 'nodejs';

const STATUSES = new Set<BalanceStatus>(['maintenance', 'surplus', 'deficit']);

function parseModel(text: string): { status: BalanceStatus; note: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[0]) as { status?: string; note?: string };
    if (!json.status || !STATUSES.has(json.status as BalanceStatus)) return null;
    if (typeof json.note !== 'string' || json.note.trim().length < 8) return null;
    return { status: json.status as BalanceStatus, note: json.note.trim().slice(0, 420) };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let readings: ScaleReading[];
  try {
    const body = await req.json() as { readings?: ScaleReading[] };
    readings = Array.isArray(body.readings) ? body.readings.slice(0, 21) : [];
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const trend = assessWeek(readings);
  if (!trend) {
    return NextResponse.json({ error: 'Not enough weigh-ins' }, { status: 422 });
  }

  const fallback = { status: trend.status, note: trend.note, source: 'trend' as const };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json(fallback);

  const prompt = `You judge whether a week of body-composition data looks like maintenance, a calorie surplus, or a calorie deficit. There is no food log. Use only the weigh-ins below. Reply with JSON only, no markdown:
{"status":"maintenance"|"surplus"|"deficit","note":"one or two sentences"}

Rules:
- maintenance: scale weight is holding, including when the week bounces from fluid, glycogen, or a drier weigh-in
- deficit: the scale finished the week meaningfully lower and body water does not explain it
- surplus: the scale finished the week meaningfully higher and body water does not explain it
- Body fat percent rising while body water falls is a drier weigh-in. Never call that a surplus.
- A swing that reverses within the week is fluid and glycogen. Do not tell the person to change calories.
- A first-pass read is ${trend.status}. Use "holding", "scale up", or "scale down" in the note. Do not use the words surplus or deficit.
- Do not invent calories, workouts, or medical advice. Use the numbers you are given.

Weigh-ins:
${trend.lines.join('\n')}`;

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
        max_tokens: 220,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('[weight-balance] Anthropic status', response.status, detail.slice(0, 180));
      return NextResponse.json(fallback);
    }

    const data = await response.json();
    const text: string = data.content?.[0]?.text ?? '';
    const parsed = parseModel(text);
    if (!parsed) return NextResponse.json(fallback);
    return NextResponse.json({ ...parsed, source: 'ai' });
  } catch (err) {
    console.error('[weight-balance] fetch error', err);
    return NextResponse.json(fallback);
  }
}
