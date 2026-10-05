import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mutual funds · Connect",
  description:
    "Track Indian mutual fund holdings against daily AMFI NAVs. Portfolio value, XIRR, and allocation. Not investment advice.",
};

export default function FundsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
