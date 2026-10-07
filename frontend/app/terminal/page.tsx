"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ModuleLoader, useLoaderHold } from "@/components/ModuleLoader";
import { Terminal } from "@/components/terminal/Terminal";
import { ApiError, api } from "@/lib/api";
import "../terminal.css";
import "../terminal-light.css";
import "../paper.css";

export default function TerminalPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; display_name: string } | null>(null);
  const [error, setError] = useState("");
  const held = useLoaderHold(!!user);

  useEffect(() => {
    api
      .me()
      .then((u) => setUser(u))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setError(err instanceof Error ? err.message : "Unable to load market data.");
      });
  }, [router]);

  if (error) {
    return (
      <main className="term-root" style={{ placeItems: "center", display: "grid" }}>
        <p className="error">{error}</p>
      </main>
    );
  }
  if (!user || !held) {
    return (
      <main className="term-root" style={{ placeItems: "center", display: "grid" }} aria-busy="true">
        <ModuleLoader kind="terminal" />
      </main>
    );
  }
  return <Terminal userId={user.id} name={user.display_name} />;
}
