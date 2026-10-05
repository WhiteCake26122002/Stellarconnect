import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduce(onChange: () => void) {
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True when the user asked the OS for reduced motion. False on the server. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduce,
    () => window.matchMedia(REDUCE_QUERY).matches,
    () => false,
  );
}

type TransitionDoc = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** Functional tab/surface swap. Skips when the user asked for reduced motion. */
export function withViewTransition(update: () => void) {
  if (typeof document === "undefined") {
    update();
    return;
  }
  const doc = document as TransitionDoc;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduce) {
    update();
    return;
  }
  doc.startViewTransition(() => {
    flushSync(update);
  });
}
