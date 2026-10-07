import type { Metadata } from "next";
import { FundDetail } from "@/components/funds/FundDetail";
import "../../dcf.css";
import "../funds.css";
import "../funds-ui.css";
import "../viz.css";

export const metadata: Metadata = {
  title: "Fund detail · Connect",
  description: "Risk, return and composition for one mutual fund scheme. Not investment advice.",
};

export default async function FundDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <FundDetail code={Number(code)} />;
}
