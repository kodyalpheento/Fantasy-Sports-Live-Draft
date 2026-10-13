// Bindings available when running on Cloudflare (see wrangler.jsonc). All optional so the app also runs on Node.
interface CloudflareEnv {
  HYPERDRIVE?: { connectionString: string };
  BACKUPS?: {
    put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<unknown>;
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    delete(key: string): Promise<void>;
  };
  REALTIME?: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
  ASSETS?: unknown;
}
