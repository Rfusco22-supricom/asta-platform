import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';

/** La plantilla de Excel del sell-out, con los productos ASTA que compra el cliente. */

const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL ?? 'http://localhost:3001';

export async function GET() {
  const sesion = await getSession();
  if (!sesion) return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sin sesión.' } }, { status: 401 });
  try {
    const res = await fetch(`${MIDDLEWARE_URL}/api/v1/account/sellout/plantilla`, {
      headers: { Authorization: `Bearer ${sesion.accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json((await res.json().catch(() => null)) ?? {}, { status: res.status });
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="sell-out-asta.xlsx"',
      },
    });
  } catch {
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'El middleware no responde.' } }, { status: 503 });
  }
}
