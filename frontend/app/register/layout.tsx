import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create account · Connect",
  description: "Create an account for paper trading and private valuation models.",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
