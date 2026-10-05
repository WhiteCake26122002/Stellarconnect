import type { Metadata } from "next";
import { HomeGate } from "@/components/home/HomeGate";
import "./home.css";

export const metadata: Metadata = {
  title: "Connect · Three desks, one account",
  description:
    "Paper-trade the Indian tape, value a company with a private DCF, and mark mutual fund holdings to the daily AMFI NAV. Simulated fills. Not investment advice.",
  openGraph: {
    title: "Connect · Three desks, one account",
    description:
      "Paper trading, private DCF models, and mutual fund books on one account. Simulated fills. Not investment advice.",
  },
};

export default function Home() {
  return <HomeGate />;
}
