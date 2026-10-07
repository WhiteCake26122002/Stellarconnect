import { Barlow_Condensed } from "next/font/google";

/** The tall, tight display face for the headlines on Home. Body text stays IBM Plex Sans. */
export const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});
