import { NextResponse } from 'next/server';
import { runScheduledBackupIfDue } from '@/lib/backups';
import { isInternalRequest } from '@/lib/internal';
import { syncPlayersIfStale } from '@/lib/players';

/** Hit every 15 minutes by the realtime worker's cron trigger. */
export async function POST(req: Request) {
  if (!(await isInternalRequest(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result: Record<string, unknown> = {};
  try {
    result.players = await syncPlayersIfStale();
  } catch (err) {
    result.playersError = err instanceof Error ? err.message : String(err);
  }
  try {
    result.backup = await runScheduledBackupIfDue();
  } catch (err) {
    result.backupError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json(result);
}
