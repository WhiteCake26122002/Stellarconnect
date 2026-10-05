"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DeskChooser } from "@/components/DeskChooser";
import { ApiError, api } from "@/lib/api";
import "./choose.css";

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
      <main className="choose-root" style={{ placeItems: "center" }}>
        <p className="error">{error}</p>
      </main>
    );
  }
  if (!ready) {
    return (
      <main className="choose-root" style={{ placeItems: "center" }} aria-busy="true">
        <p className="choose-hint">Opening desks…</p>
      </main>
    );
  }
  return <DeskChooser name={name} />;
}
