import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sales Agent Console",
  description: "Run your AI sales agent: conversations, contacts, and settings.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex">
        <Suspense fallback={<aside className="w-56 shrink-0 border-r border-stone-200" />}>
          <Sidebar />
        </Suspense>
        <main className="flex-1 min-w-0 p-8">{children}</main>
      </body>
    </html>
  );
}
