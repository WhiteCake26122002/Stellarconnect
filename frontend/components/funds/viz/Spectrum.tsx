"use client";

/** A Low–Moderate–High track with a marker. `at` runs 0 (lowest) to 1 (highest). */
export function Spectrum({ at, label, stops = ["Low", "Moderate", "High"] }: { at: number | null; label: string; stops?: string[] }) {
  if (at == null) return <p className="vz-unavailable">Unavailable</p>;
  const pos = Math.min(1, Math.max(0, at)) * 100;
  return (
    <div className="vz-spectrum" role="img" aria-label={`${label}, between ${stops[0]} and ${stops[stops.length - 1]}`}>
      <div className="vz-spec-track">
        <span className="vz-spec-marker" style={{ left: `${pos}%` }} />
      </div>
      <div className="vz-spec-stops">
        {stops.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
      <p className="vz-spec-label" style={{ marginLeft: `clamp(0%, calc(${pos}% - 2.5rem), calc(100% - 5rem))` }}>
        {label}
      </p>
    </div>
  );
}
