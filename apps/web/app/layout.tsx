import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HexaGen Monaco — Hexagonal Generator',
  description:
    'Production-ready hexagonal monorepo generator with DDD & Agentic UI',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
