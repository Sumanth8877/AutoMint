import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { Geist, Geist_Mono } from 'next/font/google';
import { clerkAppearance } from '@/lib/clerk-appearance';
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
  metadataBase: new URL('https://auto-mint-swart.vercel.app'),
  title: 'AutoMint - NFT Mint Intelligence',
  description:
    'Analyze launchpads, detect risks, forecast demand, and execute winning NFT mint strategies.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'AutoMint - NFT Mint Intelligence',
    description:
      'Analyze launchpads, detect risks, forecast demand, and execute winning NFT mint strategies.',
    url: 'https://auto-mint-swart.vercel.app',
    siteName: 'AutoMint',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'AutoMint - NFT Mint Intelligence' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AutoMint - NFT Mint Intelligence',
    description:
      'Analyze launchpads, detect risks, forecast demand, and execute winning NFT mint strategies.',
    images: ['/og-image.png'],
  },
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
          appearance={clerkAppearance}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
