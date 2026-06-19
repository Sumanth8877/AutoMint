import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { sentryConfig } from '@/lib/monitoring/sentry';
import * as Sentry from '@sentry/nextjs';
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
        <head>
          {/* Microsoft Clarity */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
              })(window, document, "clarity", "script", "${process.env.NEXT_PUBLIC_CLARITY_ID || ''}");`,
            }}
          />
        </head>
        <body className="min-h-full flex flex-col bg-[#050816]">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}