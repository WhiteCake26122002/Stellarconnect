"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { ApiError, api } from "@/lib/api";
import { DESIGNATIONS } from "@/lib/profile";

function passwordScore(value: string) {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(4, score);
}

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState("");
  const score = useMemo(() => passwordScore(password), [password]);

  useEffect(() => {
    api
      .me()
      .then(() => router.replace("/choose"))
      .catch(() => {});
  }, [router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const nextPassword = String(fd.get("password"));
    const confirm = String(fd.get("confirm"));
    if (nextPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      await api.register({
        email: String(fd.get("email")),
        password: nextPassword,
        first_name: String(fd.get("first_name")),
        last_name: String(fd.get("last_name")),
        designation: String(fd.get("designation")),
      });
      router.push("/choose");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the account.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell>
      <form className="card grid auth-card" onSubmit={onSubmit}>
        <div>
          <h1>Create account</h1>
          <p className="muted">One login for paper trading and private DCF models.</p>
        </div>
        <div className="auth-row">
          <div>
            <label htmlFor="first_name">First name</label>
            <input id="first_name" name="first_name" required autoComplete="given-name" />
          </div>
          <div>
            <label htmlFor="last_name">Last name</label>
            <input id="last_name" name="last_name" required autoComplete="family-name" />
          </div>
        </div>
        <div>
          <label htmlFor="designation">Designation</label>
          <select id="designation" name="designation" required defaultValue="">
            <option value="" disabled>
              Select designation
            </option>
            {DESIGNATIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="username" />
        </div>
        <div>
          <label htmlFor="password">Password (8+ characters)</label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={8}
            required
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="pw-meter" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <i key={i} className={i < score ? "on" : ""} />
            ))}
          </div>
          <p className="note">Use a unique password for Connect. Do not reuse a work or email password.</p>
        </div>
        <div>
          <label htmlFor="confirm">Confirm password</label>
          <input id="confirm" name="confirm" type="password" minLength={8} required autoComplete="new-password" />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </button>
        <p className="note">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
