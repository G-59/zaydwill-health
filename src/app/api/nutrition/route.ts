import { NextResponse } from 'next/server';
import { cronometerConfigured, fetchNutritionDay } from '@/lib/cronometer';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!cronometerConfigured()) {
    return NextResponse.json({ error: 'missing_credentials' }, { status: 503 });
  }

  const date = new URL(req.url).searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'bad_date' }, { status: 400 });
  }

  try {
    const day = await fetchNutritionDay(date);
    return NextResponse.json(day);
  } catch (err) {
    const code = err instanceof Error ? err.message : 'request_failed';
    const status = code === 'missing_credentials' ? 503 : code === 'totp_required' ? 401 : 502;
    console.error('[nutrition]', code);
    return NextResponse.json({ error: code }, { status });
  }
}
