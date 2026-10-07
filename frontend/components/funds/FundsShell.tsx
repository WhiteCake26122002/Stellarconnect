"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";
import { AppSwitch } from "@/components/AppSwitch";
import { ConnectLogo } from "@/components/ConnectLogo";
import { display } from "@/components/home/cinema/font";
import { api } from "@/lib/api";
import { initials } from "@/lib/format";

export function FundsShell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={`desk ${display.variable}`}>
      <header className="masthead">
        <Link className="brand-mark" href="/" aria-label="Connect home">
          <ConnectLogo size="md" />
        </Link>
        <div className="mast-tabs" aria-hidden="true" />
        <div className="mast-tools">
          <AppSwitch current="funds" />
          <AccountMenu name={name} />
        </div>
      </header>
      <main id="main" className="shell mf">
        {children}
      </main>
    </div>
  );
}

function AccountMenu({ name }: { name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="user-menu" ref={wrap}>
      <button type="button" className="ico-btn" aria-expanded={open} aria-label="Account" onClick={() => setOpen((v) => !v)}>
        <span className="avatar" aria-hidden="true">
          {initials(name || "Analyst")}
        </span>
      </button>
      {open ? (
        <div className="popover" role="menu">
          <p>
            <strong>{name || "Analyst"}</strong>
          </p>
          <p className="note">NAVs from AMFI, once a business day. Not investment advice.</p>
          <button
            type="button"
            className="btn secondary small"
            style={{ marginTop: "0.55rem", width: "100%" }}
            onClick={async () => {
              await api.logout();
              router.push("/login");
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
