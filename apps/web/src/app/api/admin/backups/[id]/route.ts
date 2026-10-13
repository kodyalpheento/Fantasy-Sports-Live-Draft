import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { readBackup } from '@/lib/backups';
import { isUuid } from '@/lib/leagues';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (!user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const file = await readBackup(id);
  if (!file) return NextResponse.json({ error: 'Backup file is missing from storage.' }, { status: 404 });
  return new Response(file.bytes as BodyInit, {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="${file.filename}"`,
      'cache-control': 'no-store',
    },
  });
}
