import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Nav } from "./_components/Nav";
import { MiniChat } from "./_components/MiniChat";
import { WalletProvider } from "./_components/WalletProvider";
import { PageContextProvider } from "./_components/PageContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Predmarks Agents",
  description: "Agentic pipeline for prediction market management",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const hasSession = cookieStore.has('session_token');

  return (
    <html lang="es">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `if(!document.cookie.includes('tz='))document.cookie='tz='+Intl.DateTimeFormat().resolvedOptions().timeZone+';path=/;max-age=31536000'` }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-gray-50 text-gray-900`}
      >
        <WalletProvider>
          <PageContextProvider>
            {hasSession && <Nav />}
            <div className={`flex ${hasSession ? 'h-[calc(100vh-3.25rem)]' : ''}`}>
              <main className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6">{children}</main>
              {hasSession && <MiniChat />}
            </div>
          </PageContextProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
