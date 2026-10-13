import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { media } from '@/db/schema';
import { isUuid } from '@/lib/leagues';

/** Uploaded audio clips (pick sounds, team announcements). IDs are random UUIDs, so links act as capabilities. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return new Response('Not found', { status: 404 });
  const [row] = await getDb().select().from(media).where(eq(media.id, id)).limit(1);
  if (!row) return new Response('Not found', { status: 404 });
  return new Response(row.data as BodyInit, {
    headers: {
      'content-type': row.contentType,
      'content-length': String(row.sizeBytes),
      'cache-control': 'private, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}
