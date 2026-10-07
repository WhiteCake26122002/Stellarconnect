"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { AuthField, PasswordField } from "@/components/auth/AuthField";
import { AlertIcon, ArrowIcon, BriefcaseIcon, CheckIcon, MailIcon } from "@/components/auth/icons";
import { useAuthEffects } from "@/components/auth/useAuthEffects";
import { ApiError, api } from "@/lib/api";
import { DESIGNATIONS } from "@/lib/profile";

const STRENGTH = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;

function passwordScore(value: string) {
  if (value.length < 8) return 0;
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
  const [done, setDone] = useState(false);
  const [password, setPassword] = useState("");
  const score = useMemo(() => passwordScore(password), [password]);
  const { formRef, buttonRef, shake, enter } = useAuthEffects();

  useEffect(() => {
    api
      .me()
      .then(() => router.replace("/"))
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
      shake();
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the account.");
      setPending(false);
      shake();
      return;
    }
    const who = `${String(fd.get("first_name") ?? "").trim()} ${String(fd.get("last_name") ?? "").trim()}`.trim();
    setDone(true);
    await enter("Setting up your desks", who ? { kicker: "Welcome", name: who } : undefined);
    router.push("/");
  }

  return (
    <AuthShell>
      <form ref={formRef} className="auth-card" onSubmit={onSubmit}>
        <header className="auth-card-head">
          <span className="auth-badge">
            <img src="/connect-mark.png" alt="" width={142} height={142} />
          </span>
          <h1>Create account</h1>
          <p className="auth-sub">One login for paper trading, private DCF models, and your mutual funds.</p>
        </header>
        <div className="auth-row">
          <AuthField id="first_name" name="first_name" label="First name" required autoComplete="given-name" />
          <AuthField id="last_name" name="last_name" label="Last name" required autoComplete="family-name" />
        </div>
        <div className="auth-field">
          <label htmlFor="designation">Designation</label>
          <div className="auth-input">
            <BriefcaseIcon className="auth-ico" />
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
        </div>
        <AuthField
          id="email"
          name="email"
          type="email"
          label="Email"
          icon={MailIcon}
          required
          autoComplete="username"
          placeholder="you@example.com"
        />
        <PasswordField
          id="password"
          name="password"
          label="Password (8+ characters)"
          minLength={8}
          required
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        >
          <div className="pw-row">
            <div className="pw-meter" data-score={score} aria-hidden>
              {Array.from({ length: 4 }).map((_, i) => (
                <i key={i} className={i < score ? "on" : ""} />
              ))}
            </div>
            <span className="pw-label" aria-live="polite">
              {password ? STRENGTH[score] : ""}
            </span>
          </div>
          <p className="auth-hint">Use a unique password for Connect. Do not reuse a work or email password.</p>
        </PasswordField>
        <PasswordField
          id="confirm"
          name="confirm"
          label="Confirm password"
          minLength={8}
          required
          autoComplete="new-password"
        />
        {error ? (
          <p className="auth-alert" role="alert">
            <AlertIcon />
            <span>{error}</span>
          </p>
        ) : null}
        <button ref={buttonRef} type="submit" className={`auth-submit${done ? " is-done" : ""}`} disabled={pending}>
          {done ? (
            <>
              <CheckIcon />
              Account created
            </>
          ) : pending ? (
            <>
              <span className="auth-spin" aria-hidden />
              Creating…
            </>
          ) : (
            <>
              Create account
              <ArrowIcon />
            </>
          )}
        </button>
        <div className="auth-or">
          <span>Already a member?</span>
        </div>
        <Link className="auth-alt" href="/login">
          Sign in
        </Link>
      </form>
    </AuthShell>
  );
}
