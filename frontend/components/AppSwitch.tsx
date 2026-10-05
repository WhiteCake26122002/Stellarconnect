import Link from "next/link";

export type DeskId = "dcf" | "trade" | "funds";

const DESKS: { id: DeskId; href: string; label: string }[] = [
  { id: "dcf", href: "/models", label: "DCF" },
  { id: "trade", href: "/terminal", label: "Paper" },
  { id: "funds", href: "/funds", label: "Funds" },
];

export function AppSwitch({ current }: { current: DeskId }) {
  return (
    <nav className="app-switch" aria-label="Switch desk" suppressHydrationWarning>
      {DESKS.filter((desk) => desk.id !== current).map((desk) => (
        <Link key={desk.id} href={desk.href} suppressHydrationWarning>
          {desk.label}
        </Link>
      ))}
    </nav>
  );
}
