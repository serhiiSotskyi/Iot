"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

export default function HeaderBar() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);

  if (pathname === "/login") {
    return null;
  }

  async function onSignOut() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore — we redirect regardless
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-mark" aria-hidden="true" />
        <div className="topbar-brand-text">
          <strong>Warehouse Sensor Node</strong>
          <span>Bay 7 · Operator console</span>
        </div>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          onClick={onSignOut}
          disabled={pending}
          className="topbar-signout"
        >
          {pending ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </header>
  );
}
