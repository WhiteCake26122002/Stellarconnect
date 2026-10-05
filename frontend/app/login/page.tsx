"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { ApiError, api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(() => router.replace("/choose"))
      .catch(() => {});
  }, [router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      await api.login(String(fd.get("email")), String(fd.get("password")));
      router.push("/choose");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell>
      <form className="card grid auth-card" onSubmit={onSubmit}>
        <div>
          <h1>Sign in</h1>
          <p className="muted">Open DCF models or the paper trading terminal. Not investment advice.</p>
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="username" />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <p className="note">
          New here? <Link href="/register">Create an account</Link>
        </p>
      </form>
    </AuthShell>
  );
}
