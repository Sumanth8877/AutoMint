import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AutoMint - NFT Mint Intelligence',
  description:
    'Analyze launchpads, detect risks, forecast demand, and execute winning NFT mint strategies.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full bg-background font-sans text-text antialiased">
        <ClerkProvider
          afterSignOutUrl="/"
          appearance={{
            variables: {
              colorPrimary: '#4F46E5',
              colorBackground: '#0F172A',
              borderRadius: '0.5rem',
            },
            elements: {
              cardBox: 'shadow-2xl shadow-black/30',
              card: 'border border-white/10 bg-surface text-text',
              formButtonPrimary: 'bg-primary hover:bg-primary-hover',
              footerActionLink: 'text-accent hover:text-text',
              headerSubtitle: 'text-muted',
              socialButtonsBlockButton: 'border-border bg-white/5 text-text hover:bg-white/10',
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
