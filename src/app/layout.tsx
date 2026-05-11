import type { Metadata } from "next";
import { Geist_Mono, Play, Siemreap } from "next/font/google";
import "./globals.css";

const play = Play({
  variable: "--font-play",
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
});

const siemreap = Siemreap({
  variable: "--font-siemreap",
  subsets: ["khmer"],
  weight: "400",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tigram — Your Telegram, organized beautifully.",
  description:
    "Tigram brings every Telegram group, channel, and media file into one elegant dashboard. Search thousands of messages, download in bulk, and switch between accounts in a click — all secured with native MTProto encryption.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${play.variable} ${siemreap.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
