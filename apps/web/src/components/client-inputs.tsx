'use client';

import { useState } from 'react';

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local picker in the viewer's time zone that submits an ISO timestamp. */
export function LocalDateTimeInput({ name, defaultValue }: { name: string; defaultValue?: string | null }) {
  const [local, setLocal] = useState(() => toLocalInput(defaultValue));
  const iso = local ? new Date(local).toISOString() : '';
  return (
    <>
      <input type="datetime-local" className="input" value={local} onChange={(e) => setLocal(e.target.value)} />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}

export function CopyButton({ text, label = 'Copy link' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      onClick={async () => {
        const url = text.startsWith('/') ? `${window.location.origin}${text}` : text;
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}

export function LocalTime({ iso }: { iso: string | null }) {
  if (!iso) return <>—</>;
  return <time dateTime={iso} suppressHydrationWarning>{new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>;
}

/** A select that submits its form as soon as it changes. */
export function AutoSubmitSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
