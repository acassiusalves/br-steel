import { NextResponse } from 'next/server';
import { debugOrderDates } from '@/app/actions';

export async function GET() {
  try {
    const result = await debugOrderDates();
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
