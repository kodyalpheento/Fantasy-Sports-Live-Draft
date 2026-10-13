import Link from 'next/link';
import type { ReactNode } from 'react';
import { requireAdmin } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center gap-4">
        <h1 className="text-2xl font-bold text-white">Administration</h1>
        <nav className="flex gap-1 text-sm">
          <Link href="/admin" className="btn-ghost btn-sm">Users &amp; players</Link>
          <Link href="/admin/backups" className="btn-ghost btn-sm">Backups</Link>
        </nav>
      </div>
      {children}
    </main>
  );
}
