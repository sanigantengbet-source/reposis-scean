import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/layout/theme-provider";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "RepoScan — Scan Before You Clone",
  description:
    "GitHub & Bitbucket Repository Security Scanner powered by ScanRepo static analysis.",
  openGraph: {
    title: "RepoScan — Scan Before You Clone",
    description:
      "GitHub & Bitbucket Repository Security Scanner powered by ScanRepo static analysis.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "RepoScan — Scan Before You Clone",
    description:
      "GitHub & Bitbucket Repository Security Scanner powered by ScanRepo static analysis.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased min-h-screen flex flex-col" suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

