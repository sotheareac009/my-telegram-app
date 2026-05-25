import type { Metadata } from "next";
import { Geist_Mono, Play, Siemreap } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// next/font CSS variables — referenced by the `--font-*` theme keys in
// globals.css, which is what generates the `font-play` / `font-siemreap`
// Tailwind utilities. Names kept distinct from the theme keys to avoid a
// CSS-variable collision (same pattern as `--font-geist-mono` → `font-mono`).
const play = Play({
  variable: "--next-play",
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
});

const siemreap = Siemreap({
  variable: "--next-siemreap",
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
  const themeScript = `
    (() => {
      try {
        const mode = localStorage.getItem("tigram-theme-mode") || "system";
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const isDark = mode === "dark" || (mode === "system" && media.matches);
        document.documentElement.classList.toggle("dark", isDark);
        document.documentElement.dataset.theme = mode;
        document.documentElement.style.colorScheme = isDark ? "dark" : "light";
      } catch {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.classList.toggle("dark", isDark);
        document.documentElement.dataset.theme = "system";
        document.documentElement.style.colorScheme = isDark ? "dark" : "light";
      }
    })();
  `;

  return (
    <html
      lang="en"
      className={`${play.variable} ${siemreap.variable} ${geistMono.variable} h-full antialiased`}
    >
      <Script
        id="theme-mode"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: themeScript }}
      />
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
