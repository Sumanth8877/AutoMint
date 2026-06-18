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
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: '#3B82F6',
          colorBackground: '#050816',
          colorNeutral: '#111827',
          borderRadius: '16px',
          fontFamily: 'Inter, sans-serif',
        } as any,
        elements: {
          card: 'bg-[#111827] border border-blue-500/15 shadow-2xl shadow-blue-500/10',
          headerTitle: 'text-white',
          headerSubtitle: 'text-muted',
          socialButtonsBlockButton:
            'bg-[#0B1120] border border-blue-500/15 text-white hover:bg-blue-500/10',
          formFieldLabel: 'text-muted',
          formFieldInput:
            'bg-[#0B1120] border border-blue-500/15 text-white placeholder:text-muted/50',
          footerActionLink: 'text-blue-500 hover:text-blue-400',
          identityPreviewText: 'text-white',
          identityPreviewEditButton: 'text-blue-500',
          formButtonPrimary:
            'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400',
        } as any,
      }}
    >
      <html lang="en" className="h-full antialiased">
        <body className="min-h-full flex flex-col">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}