"use client";

export type DeskView = "home" | "chart" | "portfolio" | "tax" | "heatmap" | "world";

const VIEWS: { id: DeskView; label: string }[] = [
  { id: "home", label: "Overview" },
  { id: "chart", label: "Chart" },
  { id: "portfolio", label: "Portfolio" },
  { id: "tax", label: "Capital gains" },
  { id: "heatmap", label: "Heat map" },
  { id: "world", label: "World map" },
];

function NavIcon({ id }: { id: DeskView }) {
  const p = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (id === "home") return <svg {...p}><rect x="3" y="3" width="5.5" height="7" rx="1" /><rect x="9.5" y="3" width="5.5" height="4" rx="1" /><rect x="3" y="11" width="5.5" height="4" rx="1" /><rect x="9.5" y="8.5" width="5.5" height="6.5" rx="1" /></svg>;
  if (id === "chart") return <svg {...p}><path d="M3 13.5l4-5 3 2.5 5-7" /><path d="M3 15h12" /></svg>;
  if (id === "portfolio") return <svg {...p}><rect x="3" y="7" width="12" height="8" rx="1.5" /><path d="M6 7V5.5A3 3 0 0 1 12 5.5V7" /></svg>;
  if (id === "tax") return <svg {...p}><path d="M4 3.5h10v11l-1.7-1.1-1.6 1.1-1.7-1.1-1.7 1.1-1.6-1.1L4 14.5z" /><path d="M6.6 11.4l4.8-4.8" /><circle cx="7" cy="7" r="0.6" /><circle cx="11" cy="11" r="0.6" /></svg>;
  if (id === "heatmap") return <svg {...p}><rect x="3" y="3" width="6.5" height="6.5" rx="0.8" /><rect x="10.5" y="3" width="4.5" height="6.5" rx="0.8" /><rect x="3" y="10.5" width="4.5" height="4.5" rx="0.8" /><rect x="8.5" y="10.5" width="6.5" height="4.5" rx="0.8" /></svg>;
  return <svg {...p}><circle cx="9" cy="9" r="6.2" /><path d="M9 2.8v12.4M2.8 9h12.4" /><path d="M4.2 5.4c1.6 1.1 3.2 1.6 4.8 1.6s3.2-.5 4.8-1.6M4.2 12.6c1.6-1.1 3.2-1.6 4.8-1.6s3.2.5 4.8 1.6" /></svg>;
}

export function DeskNav({ current, onChange }: { current: DeskView; onChange: (id: DeskView) => void }) {
  return (
    <nav className="term-sidenav" aria-label="Desk views">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          className={current === v.id ? "on" : ""}
          aria-label={v.label}
          aria-current={current === v.id ? "page" : undefined}
          title={v.label}
          onClick={() => onChange(v.id)}
        >
          <NavIcon id={v.id} />
        </button>
      ))}
    </nav>
  );
}
