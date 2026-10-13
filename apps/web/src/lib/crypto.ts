import { base64UrlDecode, base64UrlEncode } from '@fsd/core';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomToken(bytes = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Cloudflare Workers caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !saltB64 || !hashB64) return false;
  const expected = base64UrlDecode(hashB64);
  const actual = await pbkdf2(password, base64UrlDecode(saltB64), Number(iter));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not set (32 random bytes, base64).');
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypt small secrets (TOTP seeds, storage credentials) for storage in the database. */
export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), enc.encode(plain)));
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(ct)}`;
}

export async function decryptSecret(stored: string): Promise<string> {
  const [v, iv, ct] = stored.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Unrecognised secret format');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(iv) }, await encryptionKey(), base64UrlDecode(ct));
  return dec.decode(plain);
}
