"use client";

import "../app/cinema.css";
import "../app/home.css";
import { DeskHero } from "@/components/desk/DeskHero";
import { DeskRooms } from "@/components/home/DeskRooms";
import { display } from "@/components/home/cinema/font";

/** "Choose a desk": the same three rooms as the Home page, under the shared desk header. */
export function DeskChooser({ name }: { name: string }) {
  const first = (name || "there").trim().split(/\s+/)[0];
  return (
    <main id="main" className={`dk-choose cn-root ${display.variable}`}>
      <DeskHero
        n="00"
        kicker="Same account, three tools"
        echo={`Hello, ${first}.`}
        title="Choose a desk"
        lead="Open the room you want. Move across a room to try its figure, then click it."
      />
      <section className="cn-desks" aria-label="Desks">
        <DeskRooms />
      </section>
    </main>
  );
}
