import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hexagen Monaco v2',
  description: 'AI-powered hexagonal monorepo generator',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
