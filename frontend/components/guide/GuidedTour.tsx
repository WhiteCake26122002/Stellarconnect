"use client";

import { useEffect } from "react";
import { EVENTS, Joyride, STATUS, type Step } from "react-joyride";
import { setTourDone } from "@/lib/prefs";

const STEPS: Step[] = [
  {
    target: "body",
    placement: "center",
    title: "What is a DCF?",
    content:
      "A discounted cash flow (DCF) values a company by adding up the cash it should make in future years, shrunk back into today's money.",
  },
  {
    target: "[data-tour='answer']",
    placement: "left",
    title: "This is the answer",
    content:
      "The big number is what the model thinks one share is worth. The bar underneath compares it with today's market price.",
  },
  {
    target: "[data-tour='cases']",
    placement: "top",
    title: "Bear, Base and Bull",
    content:
      "Three versions of the future: Bear is pessimistic, Base is the middle case, Bull is optimistic. Click one to see its value.",
  },
  {
    target: "[data-tour='tab-assumptions']",
    placement: "bottom",
    title: "Change an assumption",
    content:
      "Every input lives in Assumptions — growth, profit margins, risk. Type a new number and the value updates after you pause.",
  },
  {
    target: "[data-tour='view-mode']",
    placement: "bottom",
    title: "Simple or Detailed",
    content:
      "Simple keeps jargon behind plain English and (?) definitions. Detailed shows the full reasoning. Replay this tour any time from the Help menu.",
  },
];

export function GuidedTour({ run, onEnd }: { run: boolean; onEnd: () => void }) {
  useEffect(() => {
    if (!run) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setTourDone(true);
      onEnd();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, onEnd]);

  return (
    <Joyride
      run={run}
      steps={STEPS}
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
          setTourDone(true);
          onEnd();
        }
      }}
    />
  );
}
