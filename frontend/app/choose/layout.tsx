import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Choose a desk · Connect",
  description: "Enter the DCF workspace or the paper trading terminal.",
};

export default function ChooseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
