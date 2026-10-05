import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Paper trading · Orbit Desk",
  description: "Chart-first paper trading workstation. Simulated markets. Not investment advice.",
};

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
