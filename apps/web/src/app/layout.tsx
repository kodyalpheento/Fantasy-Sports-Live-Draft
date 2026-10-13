import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Live Draft', template: '%s · Live Draft' },
  description: 'Run live fantasy football drafts — snake, linear and auction — with a draft board your league will love.',
};

export const viewport: Viewport = { themeColor: '#070b16' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
