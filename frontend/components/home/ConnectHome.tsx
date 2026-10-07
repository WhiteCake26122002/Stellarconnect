"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CSSProperties, useRef, useState } from "react";
import { ConnectLogo } from "@/components/ConnectLogo";
import { api } from "@/lib/api";
import { useReducedMotion } from "@/lib/motion";
import { DeskRooms } from "./DeskRooms";
import { HeroMorph } from "./cinema/HeroMorph";
import { PixelStrip } from "./cinema/PixelStrip";
import { FrameSection, OpenSection, RouteSection, TimelineSection, TourButton } from "./cinema/Sections";
import { display } from "./cinema/font";
import { slice, useScrollProgress } from "./cinema/useScroll";

export function ConnectHome({
  user,
}: {
  user: { id: string; display_name: string } | null;
}) {
  const router = useRouter();
  const first = (user?.display_name || "").split(/\s+/)[0];

  async function signOut() {
    await api.logout();
    router.push("/login");
  }

  return (
    <div className={`home-root cn-root ${display.variable}`}>
      <header className="cn-bar">
        <Link href="/" className="cn-logo" aria-label="Connect home">
          <ConnectLogo size="md" alt="Connect" />
        </Link>
        <nav aria-label="Home">
          <a href="#desks">Desks</a>
          <a href="#faq">FAQ</a>
          {user ? (
            <>
              <Link href="/terminal">Paper trading</Link>
              <Link href="/models">DCF</Link>
              <Link href="/funds">Funds</Link>
              <button type="button" className="cn-pill ghost" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login">Sign in</Link>
              <Link className="cn-pill" href="/register">
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <main id="main">
        <section className="cn-hero" aria-labelledby="cn-h1">
          <p className="cn-tag">{first ? `Welcome back, ${first}` : "Paper trading · DCF · Mutual funds"}</p>
          <h1 id="cn-h1">
            <span className="ln">
              <span>Three desks.</span>
            </span>
            <span className="ln">
              <span>One account.</span>
            </span>
          </h1>
          <HeroMorph />
          <dl className="cn-stats" aria-label="At a glance">
            <div>
              <dt>Practice cash</dt>
              <dd>₹10,00,000</dd>
            </div>
            <div>
              <dt>Desks</dt>
              <dd>3</dd>
            </div>
            <div>
              <dt>Price refresh</dt>
              <dd>20s</dd>
            </div>
            <div>
              <dt>Fund NAV</dt>
              <dd>Daily AMFI</dd>
            </div>
          </dl>
          <p className="cn-lead">
            Paper-trade the Indian market, value a company with a private DCF, or mark mutual fund holdings to the daily AMFI NAV. Simulated fills. Not investment advice.
          </p>
          <div className="cn-cta">
            {user ? (
              <Link className="cn-pill" href="/choose">
                Choose a desk
              </Link>
            ) : (
              <>
                <Link className="cn-pill" href="/register">
                  Create account
                </Link>
                <Link className="cn-pill ghost" href="/login">
                  Sign in
                </Link>
              </>
            )}
          </div>
          <TourButton />
          <p className="cn-scroll" aria-hidden>
            Scroll
            <i />
          </p>
        </section>

        <PixelStrip from="#f7f8f7" to="#060606" seed={3} />
        <FrameSection signedIn={!!user} />
        <RouteSection />
        <TimelineSection />
        <PixelStrip from="#060606" to="#f7f8f7" seed={5} />

        <OpenSection />
        <DeskStage />

        <Faq />
      </main>

      <SiteFoot signedIn={!!user} />
    </div>
  );
}

function DeskStage() {
  const wrap = useRef<HTMLElement>(null);
  // The rooms rise into place as the section scrolls in, one after the other.
  useScrollProgress(
    wrap,
    (p) => {
      wrap.current?.style.setProperty("--rise", slice(p, 0.16, 0.46).toFixed(4));
    },
    "pass",
  );
  return (
    <section className="cn-desks" id="desks" ref={wrap} aria-label="The desks">
      <DeskRooms />
    </section>
  );
}

const FAQ = [
  {
    q: "Is any of this real money?",
    a: "No. The paper desk starts every new book at ₹10,00,000 of pretend cash. Orders fill against the last quote inside the app and are never sent to a broker or exchange.",
  },
  {
    q: "Where do the prices come from?",
    a: "The paper chart takes the last Yahoo Finance quote for each symbol, refreshed about every 20 seconds while the tab is open. When no live quote is available, the chart says so and replays a sample tape instead.",
  },
  {
    q: "Where is my data kept?",
    a: "Your paper book (positions, orders, trade history) lives in this browser, so clearing site data or switching devices starts a fresh book. DCF models and mutual fund holdings are saved to your account and follow your login.",
  },
  {
    q: "How are mutual funds valued?",
    a: "Each scheme is marked to the latest NAV published by AMFI. Gains, allocation and XIRR are arithmetic on the units, prices and dates you entered, compared with Nifty 50 and Nifty 500 bought with the same rupees on the same dates.",
  },
  {
    q: "What goes into a DCF model?",
    a: "A model starts from the company's reported financials (Screener and Yahoo Finance). You set the drivers such as growth, margins and WACC, and the implied value per share updates as you change them. Models are private to your account.",
  },
  {
    q: "Is this investment advice?",
    a: "No. Connect is a practice and learning tool. Nothing here is a recommendation to buy or sell, and it is not a substitute for a SEBI-registered advisor.",
  },
];

function Faq() {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<number | null>(0);
  useScrollProgress(
    ref,
    (p) => {
      ref.current?.style.setProperty("--rise", slice(p, 0.14, 0.46).toFixed(4));
    },
    "pass",
  );
  return (
    <section className="cn-faq" id="faq" ref={ref} aria-labelledby="faq-title">
      <div className="cn-faq-head">
        <p className="cn-kick">FAQ</p>
        <h2 id="faq-title">
          <span>Questions</span> <span>before you start.</span>
        </h2>
        <p className="cn-faq-sub">Short answers on money, prices, and where your data lives.</p>
      </div>
      <ul>
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <li key={item.q} className={isOpen ? "on" : ""} style={{ "--k": i } as CSSProperties}>
              <h3>
                <button
                  type="button"
                  id={`faq-q-${i}`}
                  aria-expanded={isOpen}
                  aria-controls={`faq-a-${i}`}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <b aria-hidden>{String(i + 1).padStart(2, "0")}</b>
                  <span>{item.q}</span>
                  <i aria-hidden />
                </button>
              </h3>
              <div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} className="cn-faq-a">
                <div>
                  <p>{item.a}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The closing band: the invitation in the same big condensed type as the rest of the page, then the small print. */
function SiteFoot({ signedIn }: { signedIn: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  useScrollProgress(
    ref,
    (p) => {
      ref.current?.style.setProperty("--reveal", slice(p, 0.06, 0.3).toFixed(4));
    },
    "pass",
  );
  return (
    <footer className="cn-foot" ref={ref}>
      <p className="cn-foot-big" aria-hidden>
        <span>Practise</span> <span>with ten lakh.</span>
      </p>
      <div className="cn-foot-cta">
        {signedIn ? (
          <Link className="cn-pill teal" href="/choose">
            Choose a desk
          </Link>
        ) : (
          <>
            <Link className="cn-pill teal" href="/register">
              Create account
            </Link>
            <Link className="cn-pill line" href="/login">
              Sign in
            </Link>
          </>
        )}
      </div>
      <div className="cn-foot-row">
        <ConnectLogo size="md" alt="" />
        <p>Shashank S and Mokshagna Bingi. Paper trading, DCF, and mutual funds. Simulated fills. Not investment advice.</p>
        <nav aria-label="Desks">
          <Link href="/terminal">Paper</Link>
          <Link href="/models">DCF</Link>
          <Link href="/funds">Funds</Link>
        </nav>
        <button type="button" className="cn-top" onClick={() => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })}>
          Top <span aria-hidden>↑</span>
        </button>
      </div>
    </footer>
  );
}
