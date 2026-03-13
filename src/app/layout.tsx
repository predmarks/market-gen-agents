import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased bg-gray-50 text-gray-900`}
      >
        <nav className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-bold text-gray-900">
              Predmarks
            </Link>
            <Link
              href="/dashboard"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Propuestas
            </Link>
            <Link
              href="/dashboard/open"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Abiertos
            </Link>
            <Link
              href="/dashboard/resolution"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Resolución
            </Link>
            <Link
              href="/dashboard/monitoring"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Monitoreo
            </Link>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
