"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DeskChooser } from "@/components/DeskChooser";
import { ApiError, api } from "@/lib/api";
import "../desk.css";

export default function ChoosePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .me()
      .then((user) => {
        setName(user.display_name);
        setReady(true);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setError(err instanceof Error ? err.message : "Unable to open desks.");
      });
  }, [router]);

  if (error) {
    return (
      <main className="dk-choose">
        <p className="error">{error}</p>
      </main>
    );
  }
  if (!ready) {
    return (
      <main className="dk-choose" aria-busy="true">
        <p className="muted">Opening desks…</p>
      </main>
    );
  }
  return <DeskChooser name={name} />;
}
