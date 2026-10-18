import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sales Agent Console",
  description: "Run your AI sales agent: conversations, contacts, and settings.",
};

// The shell only. The owner console (sidebar) lives in app/(console)/layout.tsx; the public secure-form pages (app/f) have their own plain layout.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex">{children}</body>
    </html>
  );
}
