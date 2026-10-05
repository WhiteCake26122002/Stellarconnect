"use client";

import { useEffect, useState } from "react";
import { EVENTS, Joyride, STATUS, type Step } from "react-joyride";
import { setAnalyticsTourDone } from "@/lib/funds/local";

const STEPS: Step[] = [
  {
    target: "body",
    placement: "center",
    title: "Reading these numbers",
    content: "Five quick hints on the measures below. Each compares your funds with the Nifty 500 over the same dates, so the comparison is fair.",
  },
  {
    target: "[data-tour='mf-ret']",
    placement: "right",
    title: "Annualized return",
    content: "The yearly growth rate that would get you from start to today. It ignores when you added money, so it judges the funds, not your timing.",
  },
  {
    target: "[data-tour='mf-vol']",
    placement: "right",
    title: "Volatility",
    content: "How much the value swings around. Two funds with the same return can feel very different to hold: lower volatility is a smoother ride.",
  },
  {
    target: "[data-tour='mf-sharpe']",
    placement: "right",
    title: "Sharpe ratio",
    content: "Return earned for each unit of swing, after what a risk-free deposit pays. Higher is better. Above 1 is generally good; below 0 means a deposit did better.",
  },
  {
    target: "[data-tour='mf-dd']",
    placement: "right",
    title: "Max drawdown",
    content: "The worst fall from a high point to a low. It is the loss you would have had to sit through, so ask whether you could have.",
  },
  {
    target: "[data-tour='mf-rolling']",
    placement: "top",
    title: "Rolling returns",
    content: "Every 1, 3 and 5-year window, not just one start date. A tight range means the result did not depend on lucky timing.",
  },
  {
    target: "[data-tour='mf-down']",
    placement: "top",
    title: "Down markets",
    content: "How your funds held up in real sell-offs compared with the index. Falling less than the market is the point of many funds.",
  },
];

export function AnalyticsTour({ run, onEnd }: { run: boolean; onEnd: () => void }) {
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    if (!run) return;
    const present = STEPS.filter((s) => s.target === "body" || (typeof s.target === "string" && document.querySelector(s.target)));
    if (present.length < 2) {
      onEnd();
      return;
    }
    setSteps(present);
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setAnalyticsTourDone(true);
      onEnd();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, onEnd]);

  if (!run || steps.length < 2) return null;

  return (
    <Joyride
      run={run}
      steps={steps}
      continuous
      scrollToFirstStep
      locale={{ back: "Back", close: "Close", last: "Done", next: "Next", nextWithProgress: "Next ({current} of {total})", skip: "Skip tour" }}
      options={{
        buttons: ["back", "skip", "primary"],
        closeButtonAction: "skip",
        dismissKeyAction: false,
        overlayClickAction: false,
        showProgress: true,
        skipBeacon: true,
        primaryColor: "#111111",
        textColor: "#111111",
        overlayColor: "rgba(0, 0, 0, 0.55)",
        spotlightRadius: 12,
        width: 340,
        zIndex: 1000,
      }}
      onEvent={(data) => {
        if (data.type === EVENTS.TOUR_END || data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
          setAnalyticsTourDone(true);
          onEnd();
        }
      }}
    />
  );
}
