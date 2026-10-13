import 'server-only';
import { safeEqual } from '@fsd/core';

/** Requests from the realtime worker carry the shared secret as a bearer token. */
export async function isInternalRequest(req: Request): Promise<boolean> {
  const secret = process.env.REALTIME_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  return !!secret && auth.startsWith('Bearer ') && (await safeEqual(auth.slice(7), secret));
}
