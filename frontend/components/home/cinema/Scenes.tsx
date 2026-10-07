import { seeded } from "./useScroll";

// Small drawings of what each desk looks like, in Connect's palette: ink, teal, grey, and red only for a loss.
// They are drawn, not screenshots, so they stay sharp at any size and weigh nothing.

const INK = "currentColor";
// The accent is read from CSS so a desk can recolour its drawing (amber on the DCF and funds desks); Home keeps the teal.
const TEAL = "var(--dk-teal, #131313)";
const RED = "#d84e61";
const UP = "#2f9e6b";
const GREY = "rgba(127, 140, 138, 0.55)";

function candles() {
  const rnd = seeded(11);
  const out: { o: number; c: number; h: number; l: number }[] = [];
  let px = 150;
  for (let i = 0; i < 26; i++) {
    const o = px;
    const c = Math.max(70, Math.min(215, o + (rnd() - 0.42) * 22 + Math.sin(i / 3) * 4));
    out.push({ o, c, h: Math.max(o, c) + rnd() * 9, l: Math.min(o, c) - rnd() * 9 });
    px = c;
  }
  return out;
}
const BARS = candles();

/** The paper desk: a candlestick tape with the last price tagged. */
export function SceneTape() {
  const lo = Math.min(...BARS.map((b) => b.l));
  const hi = Math.max(...BARS.map((b) => b.h));
  const y = (v: number) => 250 - ((v - lo) / (hi - lo)) * 190;
  const last = BARS[BARS.length - 1];
  return (
    <g>
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1="14" x2="386" y1={70 + i * 56} y2={70 + i * 56} stroke={GREY} strokeWidth="0.6" strokeDasharray="2 5" />
      ))}
      {BARS.map((b, i) => {
        const x = 24 + i * 13.6;
        const up = b.c >= b.o;
        const col = up ? UP : RED;
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth="1.3" />
            <rect x={x - 3.6} y={y(Math.max(b.o, b.c))} width="7.2" height={Math.max(2, Math.abs(y(b.o) - y(b.c)))} fill={col} />
          </g>
        );
      })}
      <line x1="14" x2="386" y1={y(last.c)} y2={y(last.c)} stroke={TEAL} strokeWidth="1" strokeDasharray="3 3" />
      <rect x="338" y={y(last.c) - 9} width="48" height="18" rx="3" fill={TEAL} />
      <text x="362" y={y(last.c) + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--dk-on, #ffffff)" fontFamily="var(--font-mono), monospace">
        1,218.00
      </text>
    </g>
  );
}

/** The DCF desk: cash flows stepping up, a terminal value bar, and the implied value. */
export function SceneDcf() {
  const flows = [34, 42, 51, 61, 72];
  return (
    <g>
      <line x1="20" x2="380" y1="250" y2="250" stroke={INK} strokeWidth="1" opacity="0.6" />
      {flows.map((f, i) => (
        <rect key={i} x={36 + i * 40} y={250 - f * 1.9} width="26" height={f * 1.9} fill={i === flows.length - 1 ? TEAL : GREY} />
      ))}
      <rect x="248" y="250" width="0" height="0" />
      <rect x="258" y="98" width="46" height="152" fill="none" stroke={TEAL} strokeWidth="1.6" strokeDasharray="4 3" />
      <text x="281" y="90" textAnchor="middle" fontSize="9" fill={TEAL} fontFamily="var(--font-mono), monospace" fontWeight="600">
        TERMINAL
      </text>
      <rect x="318" y="140" width="46" height="110" fill={INK} />
      <text x="341" y="132" textAnchor="middle" fontSize="9" fill={INK} fontFamily="var(--font-mono), monospace" fontWeight="600">
        IMPLIED
      </text>
      <path d="M49 214 L89 204 L129 192 L169 178 L209 160 L281 98 L341 140" fill="none" stroke={TEAL} strokeWidth="1.4" opacity="0.9" />
    </g>
  );
}

/** The funds desk: an allocation donut and its legend. */
export function SceneFunds() {
  const R = 62;
  const C = 2 * Math.PI * R;
  const parts = [
    { w: 0.46, c: INK },
    { w: 0.32, c: "#7d7d7d" },
    { w: 0.22, c: "#c4c4c4" },
  ];
  let acc = 0;
  return (
    <g>
      <g transform="translate(130 150) rotate(-90)">
        {parts.map((p, i) => {
          const dash = p.w * C - 3;
          const off = -acc * C;
          acc += p.w;
          return <circle key={i} r={R} fill="none" stroke={p.c} strokeWidth="26" strokeDasharray={`${dash} ${C}`} strokeDashoffset={off} />;
        })}
      </g>
      <text x="130" y="146" textAnchor="middle" fontSize="26" fontWeight="800" fill={INK} fontFamily="var(--font-display), sans-serif">
        46%
      </text>
      <text x="130" y="164" textAnchor="middle" fontSize="9" fill={INK} opacity="0.7" fontFamily="var(--font-mono), monospace">
        FLEXI CAP
      </text>
      {["Flexi cap", "Debt", "ELSS"].map((n, i) => (
        <g key={n} transform={`translate(240 ${108 + i * 30})`}>
          <rect width="11" height="11" rx="2" fill={parts[i].c} />
          <text x="20" y="10" fontSize="12" fill={INK} fontFamily="var(--font-mono), monospace">
            {n}
          </text>
          <text x="124" y="10" fontSize="12" fill={INK} textAnchor="end" fontWeight="700" fontFamily="var(--font-mono), monospace">
            {Math.round(parts[i].w * 100)}%
          </text>
        </g>
      ))}
    </g>
  );
}

/** A sign-in card: an avatar and three lines of a form. */
export function SceneAccount() {
  return (
    <g>
      <rect x="86" y="46" width="228" height="208" rx="14" fill="none" stroke={INK} strokeWidth="1.4" opacity="0.8" />
      <circle cx="200" cy="100" r="24" fill="none" stroke={TEAL} strokeWidth="2.4" />
      <path d="M186 106 q14 -22 28 0" fill="none" stroke={TEAL} strokeWidth="2.4" />
      {[148, 176, 204].map((y, i) => (
        <rect key={y} x="112" y={y} width={i === 2 ? 176 : 176} height="16" rx="3" fill="none" stroke={GREY} strokeWidth="1.2" />
      ))}
      <rect x="112" y="226" width="176" height="18" rx="9" fill={TEAL} />
    </g>
  );
}

/** The paper book: ₹10,00,000 of cash and an empty bar to fill. */
export function SceneBook() {
  return (
    <g>
      <text x="200" y="128" textAnchor="middle" fontSize="42" fontWeight="800" fill={INK} fontFamily="var(--font-display), sans-serif">
        ₹10,00,000
      </text>
      <text x="200" y="152" textAnchor="middle" fontSize="11" fill={INK} opacity="0.7" fontFamily="var(--font-mono), monospace">
        STARTING PAPER CASH
      </text>
      <rect x="70" y="184" width="260" height="10" rx="5" fill="none" stroke={GREY} strokeWidth="1.2" />
      <rect x="70" y="184" width="260" height="10" rx="5" fill={TEAL} />
      <text x="70" y="216" fontSize="10" fill={INK} fontFamily="var(--font-mono), monospace">
        Cash 100%
      </text>
      <text x="330" y="216" fontSize="10" fill={INK} textAnchor="end" fontFamily="var(--font-mono), monospace">
        Invested 0%
      </text>
    </g>
  );
}

export const SCENES = {
  tape: SceneTape,
  dcf: SceneDcf,
  funds: SceneFunds,
  account: SceneAccount,
  book: SceneBook,
} as const;

export type SceneId = keyof typeof SCENES;

export function Scene({ id, className, label }: { id: SceneId; className?: string; label: string }) {
  const S = SCENES[id];
  return (
    <svg className={className} viewBox="0 0 400 300" role="img" aria-label={label}>
      <S />
    </svg>
  );
}
