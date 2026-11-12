import { NextRequest, NextResponse } from 'next/server';
import { format, subDays } from 'date-fns';
import { fetchScaleHistory } from '@/lib/garmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const days = Math.min(400, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 90));
  const end = format(new Date(), 'yyyy-MM-dd');
  const start = format(subDays(new Date(), days - 1), 'yyyy-MM-dd');

  try {
    const readings = await fetchScaleHistory(start, end);
    return NextResponse.json({ start, end, readings });
  } catch (err) {
    console.error('[API] /weight error:', err);
    return NextResponse.json({ error: 'Failed to fetch weight data' }, { status: 500 });
  }
}
