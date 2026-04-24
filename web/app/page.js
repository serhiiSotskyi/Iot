"use client";

import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 500;

const emptyState = {
  ok: true,
  latest: null
};

export default function HomePage() {
  const [payload, setPayload] = useState(emptyState);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadLatest() {
      try {
        const response = await fetch("/api/latest", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`GET /api/latest failed with ${response.status}`);
        }

        const nextPayload = await response.json();
        if (!cancelled) {
          setPayload(nextPayload);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      }
    }

    loadLatest();
    const timer = window.setInterval(loadLatest, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const latest = payload.latest;
  const hasMovement = latest?.event === "movement";

  return (
    <main className="dashboard-shell">
      <section className="hero-card">
        <p className="eyebrow">Nano 33 BLE Demo</p>
        <h1>Live event monitor</h1>
        <p className="hero-copy">
          Polling <code>/api/latest</code> every {POLL_INTERVAL_MS} ms and showing the most recent
          event received from the serial bridge.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <p className="panel-label">Latest event</p>
          <p className="event-name">{latest?.event ?? "waiting_for_data"}</p>
          <p className="meta-line">Updated: {latest?.receivedAt ?? "No events received yet"}</p>
          {latest?.colour ? <p className="meta-line">Colour: {latest.colour}</p> : null}
          {latest?.direction ? <p className="meta-line">Direction: {latest.direction}</p> : null}
          {error ? <p className="error-line">Error: {error}</p> : null}
        </article>

        <article className="panel">
          <p className="panel-label">Movement data</p>
          {hasMovement ? (
            <div className="movement-grid">
              <Metric label="ax" value={latest.ax} />
              <Metric label="ay" value={latest.ay} />
              <Metric label="az" value={latest.az} />
              <Metric label="gx" value={latest.gx} />
              <Metric label="gy" value={latest.gy} />
              <Metric label="gz" value={latest.gz} />
            </div>
          ) : (
            <p className="placeholder">Movement values appear here once tracking starts.</p>
          )}
        </article>
      </section>

      <section className="panel raw-panel">
        <p className="panel-label">Raw JSON</p>
        <pre>{JSON.stringify(latest, null, 2) ?? "null"}</pre>
      </section>
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{typeof value === "number" ? value.toFixed(3) : "--"}</strong>
    </div>
  );
}

