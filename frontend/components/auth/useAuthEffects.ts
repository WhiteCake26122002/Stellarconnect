"use client";

import { useCallback, useRef } from "react";
import { playCurtain } from "@/lib/curtain";
import { useReducedMotion } from "@/lib/motion";

const SHAKE = [
  { transform: "translateX(0)" },
  { transform: "translateX(-9px)" },
  { transform: "translateX(8px)" },
  { transform: "translateX(-5px)" },
  { transform: "translateX(3px)" },
  { transform: "translateX(0)" },
];

/** Shared feedback for the sign-in and register forms: a shake on failure, and on success a short
 *  pause for the check mark followed by the full-screen iris that carries the visitor home, with a welcome by name. */
export function useAuthEffects() {
  const reduce = useReducedMotion();
  const formRef = useRef<HTMLFormElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const shake = useCallback(() => {
    if (reduce) return;
    formRef.current?.animate(SHAKE, { duration: 420, easing: "ease-out" });
  }, [reduce]);

  /** Resolves once the screen is covered, which is when it is safe to navigate. */
  const enter = useCallback(
    async (label: string, greeting?: { kicker: string; name: string }) => {
      if (!reduce) await new Promise((resolve) => window.setTimeout(resolve, 420));
      const r = buttonRef.current?.getBoundingClientRect();
      await playCurtain({
        x: r ? r.left + r.width / 2 : window.innerWidth / 2,
        y: r ? r.top + r.height / 2 : window.innerHeight / 2,
        label,
        greeting,
        minShowMs: greeting ? 2600 : undefined,
      });
    },
    [reduce],
  );

  return { formRef, buttonRef, shake, enter };
}
