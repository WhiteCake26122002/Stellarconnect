"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { ConnectHome } from "@/components/home/ConnectHome";

export function HomeGate() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; display_name: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .me()
      .then((u) => {
        setUser(u);
        setReady(true);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setUser(null);
          setReady(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Unable to open Connect.");
        setReady(true);
      });
  }, [router]);

  if (!ready) {
    return (
      <main id="main" className="home-root" aria-busy="true">
        <p className="home-hero" style={{ margin: 0 }}>Opening Connect…</p>
      </main>
    );
  }
  if (error) {
    return (
      <main id="main" className="home-root">
        <p className="error" style={{ padding: "2rem" }}>
          {error}
        </p>
      </main>
    );
  }
  return <ConnectHome user={user} />;
}
