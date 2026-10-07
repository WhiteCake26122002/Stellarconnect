import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { MotionEnhancer } from "@/components/MotionEnhancer";
import { PageCurtain } from "@/components/PageCurtain";
import "./globals.css";
import "./polish.css";
import "./interact.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Connect",
  description: "DCF valuation, paper trading, and mutual fund tracking. Simulated markets. Not investment advice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>
        {/* Browser tooling (e.g. Cursor's embedded browser) tags header controls with data-* refs before hydration. */}
        <a className="skip" href="#main" suppressHydrationWarning>
          Skip to content
        </a>
        {children}
        <PageCurtain />
        <MotionEnhancer />
      </body>
    </html>
  );
}
