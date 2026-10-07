import "../../app/desk.css";
import { ReactNode } from "react";
import { display } from "@/components/home/cinema/font";
import type { SceneId } from "@/components/home/cinema/Scenes";
import { DeskFigure } from "./DeskFigure";

export type DeskStat = { k: string; v: string };

/**
 * The header every desk opens with, in the same language as the Home page: a mono kicker, a tall condensed title with an
 * outlined echo line above it, teal corner marks and a rule that draw themselves in, a few honest figures, and a small
 * drawn picture of what the desk does. The `title` is the page's real h1; the `echo` is decoration only.
 */
export function DeskHero({
  n,
  kicker,
  echo,
  title,
  lead,
  stats,
  actions,
  scene,
  sceneLabel,
  compact,
}: {
  n: string;
  kicker: string;
  echo: string;
  title: string;
  lead?: ReactNode;
  stats?: DeskStat[];
  actions?: ReactNode;
  scene?: SceneId;
  sceneLabel?: string;
  compact?: boolean;
}) {
  return (
    <header className={`dk-hero ${display.variable}${compact ? " compact" : ""}`}>
      <div className="dk-main">
        <p className="dk-kick">
          <b>{n}</b>
          {kicker}
        </p>
        <p className="dk-echo" aria-hidden>
          <span>{echo}</span>
        </p>
        <h1 className="dk-title">
          <span>{title}</span>
        </h1>
        {lead ? <p className="dk-lead">{lead}</p> : null}
        {actions ? <div className="dk-actions">{actions}</div> : null}
      </div>
      {stats?.length || scene ? (
        <div className="dk-side">
          {stats?.length ? (
            <dl className="dk-stats" aria-label="At a glance">
              {stats.map((s) => (
                <div key={s.k}>
                  <dt>{s.k}</dt>
                  <dd>{s.v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {scene ? (
            <DeskFigure scene={scene} label={sceneLabel ?? ""} />
          ) : null}
        </div>
      ) : null}
      <i className="dk-rule" aria-hidden />
    </header>
  );
}
