"use client";

import { useState } from "react";

const TEAM = [
  {
    name: "Shashank S",
    role: "Finance",
    src: "/team/shashank.jpg",
    width: 800,
    height: 800,
    headline: [
      "Active trader in equities, derivatives & commodities",
      "Investment banking intern",
      "M.Com (International Finance) graduate",
    ],
    linkedin: "https://www.linkedin.com/in/shashankshubhakar/",
  },
  {
    name: "Mokshagna Bingi",
    role: "Technology",
    src: "/team/mokshagna.jpg",
    width: 1024,
    height: 1024,
    headline: ["AI & Automation Engineer @ Charantra.ai", "GenAI · ML · Cloud"],
    linkedin: "https://www.linkedin.com/in/mokshagna-bingi-a299a6229/",
  },
];

/** Not rendered on the home page right now; add <Team /> back to ConnectHome to restore it. */
export function Team() {
  const [active, setActive] = useState(0);
  const person = TEAM[active];
  return (
    <section className="home-team" id="team" aria-labelledby="team-title">
      <div className="home-team-head">
        <p className="home-kicker">Team</p>
        <h2 id="team-title">Who builds Connect</h2>
        <p>Point at a portrait to see their background and LinkedIn.</p>
      </div>
      <ul>
        {TEAM.map((member, i) => (
          <li key={member.name} className={i === active ? "on" : ""}>
            <button
              type="button"
              aria-pressed={i === active}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
            >
              <img
                src={member.src}
                alt=""
                width={member.width}
                height={member.height}
              />
              <h3>{member.name}</h3>
              <p>{member.role}</p>
            </button>
          </li>
        ))}
      </ul>
      <div className="home-team-note">
        <div aria-live="polite">
          <strong>{person.name}</strong>
          <span>{person.role}</span>
          <ul className="home-team-headline">
            {person.headline.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <a
          className="home-linkedin"
          href={person.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${person.name} on LinkedIn (opens in a new tab)`}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <path
              fill="currentColor"
              d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"
            />
          </svg>
          View LinkedIn
        </a>
      </div>
    </section>
  );
}
