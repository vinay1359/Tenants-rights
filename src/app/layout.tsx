import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import { AppProviders } from '@/components/providers';

export const metadata: Metadata = {
  title: 'Tenant Rights Checker - Is My Landlord Allowed to Do This?',
  description:
    'Free AI-powered tenant rights checker. Find out if what your landlord did is legal, get the specific law that covers it, and generate ready-to-send emails and demand letters.',
  keywords: 'tenant rights, landlord, renter, housing law, eviction, security deposit, tenant protection',
  openGraph: {
    title: 'Tenant Rights Checker',
    description: 'AI-powered tool to check if your landlord is breaking the law. Free, instant, with real statute citations.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M16 1C16 1 4 6 4 14v8c0 5 5.5 8.5 12 9 6.5-.5 12-4 12-9v-8c0-8-12-13-12-13z' fill='%23111'/%3E%3Cpath d='M16 8l-7 6v8h5v-5h4v5h5v-8l-7-6z' fill='%23fff'/%3E%3C/svg%3E"
        />
      </head>
      <body suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
        <Analytics />
      </body>
    </html>
  );
}
