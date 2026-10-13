'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function LeagueTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-white/5">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link key={t.href} href={t.href}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${active ? 'border-brand-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
