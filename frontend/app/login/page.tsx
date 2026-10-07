"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { AuthField, PasswordField } from "@/components/auth/AuthField";
import { ActivityIcon, AlertIcon, ArrowIcon, CheckIcon, LockIcon, MailIcon, ShieldIcon } from "@/components/auth/icons";
import { useAuthEffects } from "@/components/auth/useAuthEffects";
import { ApiError, api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
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
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      await api.login(String(fd.get("email")), String(fd.get("password")));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
      setPending(false);
      shake();
      return;
    }
    // Signed in: land the check mark, greet them by name, and let the iris carry them home.
    const who = await api.me().then((u) => u.display_name).catch(() => "");
    setDone(true);
    await enter("Taking you home", who ? { kicker: "Welcome back", name: who } : undefined);
    router.push("/");
  }

  return (
    <AuthShell>
      <form ref={formRef} className="auth-card" onSubmit={onSubmit}>
        <header className="auth-card-head">
          <span className="auth-badge">
            <img src="/connect-mark.png" alt="" width={142} height={142} />
          </span>
          <h1>Sign in</h1>
          <p className="auth-sub">
            Pick up where you left off: DCF models, the paper trading terminal, or your mutual funds.
          </p>
        </header>
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
          label="Password"
          required
          autoComplete="current-password"
          placeholder="Your password"
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
              Signed in
            </>
          ) : pending ? (
            <>
              <span className="auth-spin" aria-hidden />
              Signing in…
            </>
          ) : (
            <>
              Sign in
              <ArrowIcon />
            </>
          )}
        </button>
        <div className="auth-or">
          <span>New to Connect?</span>
        </div>
        <Link className="auth-alt" href="/register">
          Create an account
        </Link>
        <ul className="auth-trust">
          <li>
            <ActivityIcon /> Simulated fills
          </li>
          <li>
            <ShieldIcon /> No brokerage link
          </li>
          <li>
            <LockIcon /> Private by default
          </li>
        </ul>
      </form>
    </AuthShell>
  );
}
