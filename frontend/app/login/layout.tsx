import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in · Connect",
  description: "Sign in to DCF models or paper trading. Not investment advice.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
