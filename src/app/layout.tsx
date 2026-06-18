import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'AutoMint - Premium NFT Minting Dashboard',
  description:
    'Automate public NFT mint tracking, manage wallets, and monitor collections from one premium dashboard.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="h-full antialiased">
        <body className="min-h-full flex flex-col bg-[#050816]">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}