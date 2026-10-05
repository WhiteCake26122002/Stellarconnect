"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { AppSwitch } from "@/components/AppSwitch";

export function Topbar({ name, status }: { name?: string; status?: string }) {
  const router = useRouter();
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        DCF Workstation
        <small>Analyst desk</small>
      </Link>
      <div className="topbar-actions">
        <AppSwitch current="dcf" />
        {status ? (
          <span className="muted" aria-live="polite">
            {status}
          </span>
        ) : null}
        {name ? <span className="muted">{name}</span> : null}
        <button
          type="button"
          className="btn secondary small"
          onClick={async () => {
            await api.logout();
            router.push("/login");
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
