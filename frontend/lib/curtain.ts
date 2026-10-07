export type CurtainDetail = {
  /** Where the iris opens from, in viewport px (the sign-in button). */
  x: number;
  y: number;
  /** Line shown under the mark while the next page loads. */
  label: string;
  /** A welcome shown big under the mark ("Welcome back" over the person's name). */
  greeting?: { kicker: string; name: string };
  /** Keeps the curtain up at least this long after it opened, so a greeting can be read. */
  minShowMs?: number;
};

/**
 * Plays the full-screen "iris" transition and resolves once the screen is fully covered, which is
 * the moment it is safe to navigate. The <PageCurtain/> in the root layout owns the overlay, so it
 * survives the route change and lifts itself once the new page is ready. Resolves immediately when
 * the visitor asked for reduced motion, so callers can simply navigate.
 */
export function playCurtain(detail: CurtainDetail): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      resolve();
      return;
    }
    const finish = () => {
      window.removeEventListener("connect:curtain-covered", finish);
      window.clearTimeout(fallback);
      resolve();
    };
    const fallback = window.setTimeout(finish, 1800);
    window.addEventListener("connect:curtain-covered", finish);
    window.dispatchEvent(new CustomEvent<CurtainDetail>("connect:curtain", { detail }));
  });
}
