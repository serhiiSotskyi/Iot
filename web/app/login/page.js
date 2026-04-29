"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });

      if (response.ok) {
        const params = new URLSearchParams(window.location.search);
        const dest = params.get("from") || "/";
        window.location.assign(dest.startsWith("/") ? dest : "/");
        return;
      }

      const body = await response.json().catch(() => ({}));
      setError(body.error || `Sign-in failed (HTTP ${response.status}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <p className="login-eyebrow">Warehouse sensor node</p>
        <h1 className="login-heading">Operator sign-in</h1>
        <p className="login-help">
          Enter the deployment password set in <code>DASHBOARD_PASSWORD</code>.
        </p>

        <label className="login-field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="current-password"
            required
          />
        </label>

        {error ? <p className="login-error">{error}</p> : null}

        <button type="submit" className="login-submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
