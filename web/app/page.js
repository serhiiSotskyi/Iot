"use client";

import { useEffect, useState } from "react";

const LATEST_POLL_INTERVAL_MS = 500;
const SESSION_POLL_INTERVAL_MS = 2000;
const ADMIN_TOKEN_STORAGE_KEY = "iot_demo_admin_token";

const EVENT_LABELS = {
  setup_status: "Sensor node booted",
  voice_start: "Operator scan command armed",
  colour_authenticated: "Package tag verified",
  movement: "Package handling motion",
  init_error: "Sensor fault",
  session_complete: "Pick session closed",
  voice_debug: "Voice scanner telemetry",
  colour_debug: "Tag scanner telemetry",
  debug: "Diagnostic"
};

function labelForEvent(eventName) {
  if (!eventName) return "Awaiting scanner";
  return EVENT_LABELS[eventName] ?? eventName;
}

function dotForEvent(eventName) {
  if (!eventName) return "dot";
  if (eventName === "init_error") return "dot dot-err";
  if (
    eventName === "voice_start" ||
    eventName === "colour_authenticated" ||
    eventName === "movement" ||
    eventName === "setup_status"
  ) {
    return "dot dot-ok";
  }
  if (eventName === "session_complete") return "dot dot-info";
  return "dot dot-warn";
}

const emptyLatestState = {
  ok: true,
  latest: null
};

const emptySessionsState = {
  ok: true,
  sessions: []
};

async function fetchLatest() {
  const response = await fetch("/api/latest", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET /api/latest failed with ${response.status}`);
  }

  return response.json();
}

async function fetchSessions() {
  const response = await fetch("/api/sessions", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET /api/sessions failed with ${response.status}`);
  }

  return response.json();
}

async function fetchSessionDetail(id) {
  const response = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`GET /api/sessions/${id} failed with ${response.status}`);
  }

  return response.json();
}

export default function HomePage() {
  const [payload, setPayload] = useState(emptyLatestState);
  const [sessionsPayload, setSessionsPayload] = useState(emptySessionsState);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [followLiveSession, setFollowLiveSession] = useState(true);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [error, setError] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [stopPending, setStopPending] = useState(false);
  const [selectedEventIndex, setSelectedEventIndex] = useState(0);
  const latest = payload.latest;
  const sessions = sessionsPayload.sessions;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const nextPayload = await fetchLatest();
      if (!cancelled) {
        setPayload(nextPayload);
        setError("");
      }
    }

    load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
    const timer = window.setInterval(() => {
      load().catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      });
    }, LATEST_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const nextPayload = await fetchSessions();
      if (!cancelled) {
        setSessionsPayload(nextPayload);
      }
    }

    load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
    const timer = window.setInterval(() => {
      load().catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      });
    }, SESSION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId && sessionsPayload.sessions.length > 0) {
      setSelectedSessionId(sessionsPayload.sessions[0].id);
    }
  }, [selectedSessionId, sessionsPayload.sessions]);

  useEffect(() => {
    const newRecordingStarted = latest?.event === "setup_status";
    if (
      latest?.sessionId &&
      latest.sessionId !== selectedSessionId &&
      (followLiveSession || newRecordingStarted)
    ) {
      setSelectedSessionId(latest.sessionId);
      setSelectedEventIndex(0);
      setFollowLiveSession(true);
    }
  }, [followLiveSession, latest?.event, latest?.sessionId, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      return undefined;
    }

    let cancelled = false;

    async function load() {
      const nextPayload = await fetchSessionDetail(selectedSessionId);
      if (!cancelled) {
        setSessionDetail(nextPayload);
      }
    }

    load().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
    const timer = window.setInterval(() => {
      load().catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      });
    }, SESSION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedSessionId]);

  const hasMovement = latest?.event === "movement";
  const movementConfidence =
    typeof latest?.movementConfidence === "number" ? latest.movementConfidence : null;
  const greenConfidence =
    typeof latest?.greenConfidence === "number" ? latest.greenConfidence : null;
  const topConfidence =
    typeof latest?.topConfidence === "number" ? latest.topConfidence : null;
  const voiceStartConfidence =
    typeof latest?.scores?.start === "number" ? latest.scores.start : null;
  const canStopSession = sessionDetail?.session?.status === "active";
  const replayEvents = getReplayEvents(sessionDetail?.events ?? []);
  const selectedReplayEvent =
    replayEvents.length > 0
      ? replayEvents[Math.min(selectedEventIndex, replayEvents.length - 1)]
      : null;

  function selectSession(id) {
    setSelectedSessionId(id);
    setSelectedEventIndex(0);
    setFollowLiveSession(false);
  }

  function showLiveSession() {
    setFollowLiveSession(true);
    if (latest?.sessionId) {
      setSelectedSessionId(latest.sessionId);
      setSelectedEventIndex(0);
    }
  }

  function showNextData() {
    if (replayEvents.length === 0) {
      return;
    }

    setSelectedEventIndex((currentIndex) => (currentIndex + 1) % replayEvents.length);
  }

  async function refreshSessionViews(nextSelectedId = selectedSessionId) {
    const [nextLatest, nextSessions] = await Promise.all([
      fetchLatest(),
      fetchSessions()
    ]);

    setPayload(nextLatest);
    setSessionsPayload(nextSessions);

    if (nextSelectedId) {
      setSessionDetail(await fetchSessionDetail(nextSelectedId));
    } else {
      setSelectedSessionId(nextSessions.sessions[0]?.id ?? "");
      setSessionDetail(null);
    }
  }

  async function stopCurrentSession() {
    setStopPending(true);
    setError("");
    setSessionMessage("");

    try {
      let adminToken = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? "";
      let response = await postCompleteCurrentSession(adminToken);
      let result = await response.json();

      if (response.status === 401 && adminToken) {
        window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        throw new Error("Unauthorized. Admin token was cleared; try Stop again with the correct token.");
      }

      if (response.status === 401) {
        const enteredToken = window.prompt(
          "Enter the admin token for this demo server."
        );
        if (enteredToken === null) {
          setSessionMessage("End connection cancelled.");
          return;
        }

        adminToken = enteredToken.trim();
        if (adminToken) {
          window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken);
        }

        response = await postCompleteCurrentSession(adminToken);
        result = await response.json();
      }

      if (response.status === 401) {
        window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        throw new Error("Unauthorized. Admin token was cleared; try Stop again with the correct token.");
      }

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? `POST failed with ${response.status}`);
      }

      if (result.deleted) {
        setSessionMessage(
          "Incomplete recording deleted. Voice and colour must both pass before data is saved."
        );
        await refreshSessionViews("");
      } else if (result.completed) {
        setSessionMessage("Recording saved. The bridge is stopping now.");
        await refreshSessionViews(result.session?.id ?? selectedSessionId);
      } else {
        setSessionMessage("No active connection to end. The bridge stop signal was still sent.");
        await refreshSessionViews("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setStopPending(false);
    }
  }

  function postCompleteCurrentSession(adminToken) {
    const headers = adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined;
    return fetch("/api/sessions/current/complete", {
      method: "POST",
      cache: "no-store",
      headers
    });
  }

  return (
    <main className="dashboard-shell">
      <section className="status-bar" aria-label="Live system status">
        <div className="status-bar-item">
          <span className={dotForEvent(latest?.event)} />
          <strong>{labelForEvent(latest?.event)}</strong>
        </div>
        <span className="status-bar-divider" aria-hidden="true" />
        <div className="status-bar-item">
          <span>Last event</span>
          <strong className="tnum">{latest?.receivedAt ? formatTime(latest.receivedAt) : "—"}</strong>
        </div>
        <span className="status-bar-divider" aria-hidden="true" />
        <div className="status-bar-item">
          <span>Active pick</span>
          <strong className="tnum">{latest?.sessionId ? shortId(latest.sessionId) : "—"}</strong>
        </div>
        {error ? (
          <>
            <span className="status-bar-divider" aria-hidden="true" />
            <div className="status-bar-item">
              <span className="dot dot-err" />
              <strong style={{ color: "var(--err)" }}>{error}</strong>
            </div>
          </>
        ) : null}
      </section>

      <section className="grid">
        <article className="panel">
          <p className="panel-label">Live scanner</p>
          <p className="event-name">{labelForEvent(latest?.event)}</p>
          {latest?.colour ? <p className="meta-line">Tag colour · {latest.colour}</p> : null}
          {latest?.direction ? <p className="meta-line">Direction · {latest.direction}</p> : null}
          {latest?.movementClass ? (
            <p className="meta-line">
              Motion class · {latest.movementClass}
              {movementConfidence !== null ? ` (${movementConfidence.toFixed(3)})` : ""}
            </p>
          ) : null}
          {greenConfidence !== null ? (
            <p className="meta-line">Verified-tag conf · {greenConfidence.toFixed(3)}</p>
          ) : null}
          {latest?.topLabel ? (
            <p className="meta-line">
              Top tag · {latest.topLabel}
              {topConfidence !== null ? ` (${topConfidence.toFixed(3)})` : ""}
            </p>
          ) : null}
          {voiceStartConfidence !== null ? (
            <p className="meta-line">Scan-cmd conf · {voiceStartConfidence.toFixed(3)}</p>
          ) : null}
          {!latest ? (
            <p className="placeholder">No scanner events received yet.</p>
          ) : null}
        </article>

        <article className="panel">
          <p className="panel-label">Package handling motion</p>
          {hasMovement ? (
            <>
              <div className="movement-class-row">
                <span>{latest.movementClass ?? "unknown"}</span>
                <strong>
                  {movementConfidence !== null ? `${(movementConfidence * 100).toFixed(1)}%` : "—"}
                </strong>
              </div>
              <div className="movement-grid">
                <Metric label="ax" value={latest.ax} />
                <Metric label="ay" value={latest.ay} />
                <Metric label="az" value={latest.az} />
                <Metric label="gx" value={latest.gx} />
                <Metric label="gy" value={latest.gy} />
                <Metric label="gz" value={latest.gz} />
              </div>
            </>
          ) : (
            <p className="placeholder">
              Handling-motion telemetry appears once the operator picks up the verified package.
            </p>
          )}
        </article>
      </section>

      <section className="session-layout">
        <article className="panel">
          <p className="panel-label">Recent pick sessions</p>
          <div className="session-list-heading">
            <p className="session-count">{sessions.length} recent picks</p>
            <button className="live-session-button" onClick={showLiveSession} type="button">
              Follow active
            </button>
          </div>
          <div className="session-list">
            {sessions.length > 0 ? (
              sessions.map((session) => (
                <button
                  className={`session-button ${
                    selectedSessionId === session.id ? "session-button-active" : ""
                  }`}
                  key={session.id}
                  onClick={() => selectSession(session.id)}
                  type="button"
                >
                  <div className="session-button-row">
                    <strong>{formatTime(session.startedAt)}</strong>
                    <span className={`status-pill status-${session.status}`}>{session.status}</span>
                  </div>
                  <em>{shortId(session.id)}</em>
                  <small>
                    {session.eventCount} events · {labelForEvent(session.triggerEvent)}
                  </small>
                </button>
              ))
            ) : (
              <p className="placeholder">Pick sessions will appear after the first scanner event.</p>
            )}
          </div>
        </article>

        <article className="panel session-detail-panel">
          <p className="panel-label">Pick session replay</p>
          {sessionDetail?.session ? (
            <>
              <div className="session-heading">
                <div>
                  <h2>{shortId(sessionDetail.session.id)}</h2>
                  <p className="meta-line">
                    Started {formatDateTime(sessionDetail.session.startedAt)} ·{" "}
                    {sessionDetail.session.eventCount} events
                  </p>
                </div>
                <span className={`status-pill status-${sessionDetail.session.status}`}>
                  {sessionDetail.session.status}
                </span>
              </div>
              <div className="session-actions">
                <button
                  className="stop-session-button"
                  disabled={!canStopSession || stopPending}
                  onClick={stopCurrentSession}
                  type="button"
                >
                  {stopPending ? "Closing pick…" : "End pick session"}
                </button>
                <button
                  className="next-data-button"
                  disabled={replayEvents.length === 0}
                  onClick={showNextData}
                  type="button"
                >
                  Next data
                </button>
                <p className="meta-line">
                  {sessionMessage ||
                    (canStopSession
                      ? "Ending the pick saves only sessions where both voice arming and tag verification passed."
                      : "This pick session is no longer active.")}
                </p>
              </div>

              <MilestoneRow session={sessionDetail.session} />
              <SelectedEventCard
                event={selectedReplayEvent}
                index={selectedEventIndex}
                total={replayEvents.length}
              />
              <EventTimeline
                events={replayEvents}
                selectedEventId={selectedReplayEvent?.id}
                onSelectEvent={(event) => {
                  const nextIndex = replayEvents.findIndex((item) => item.id === event.id);
                  if (nextIndex >= 0) {
                    setSelectedEventIndex(nextIndex);
                  }
                }}
              />
              <MovementChart samples={sessionDetail.movementSamples ?? []} />
            </>
          ) : (
            <p className="placeholder">Select a pick session to inspect its recorded timeline.</p>
          )}
        </article>
      </section>

      <details className="panel raw-panel">
        <summary className="raw-panel-summary">Raw scanner payload</summary>
        <pre>{JSON.stringify(latest, null, 2) ?? "null"}</pre>
      </details>
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{typeof value === "number" ? value.toFixed(3) : "—"}</strong>
    </div>
  );
}

function MilestoneRow({ session }) {
  const milestones = [
    ["scanner boot", session.startedAt],
    ["voice arm", session.voiceStartedAt],
    ["tag verified", session.colourAuthenticatedAt],
    ["handling", session.movementStartedAt]
  ];

  return (
    <div className="milestone-row">
      {milestones.map(([label, value]) => (
        <div className={value ? "milestone-hit" : "milestone-miss"} key={label}>
          <span>{label}</span>
          <strong>{value ? formatTime(value) : "—"}</strong>
        </div>
      ))}
    </div>
  );
}

function SelectedEventCard({ event, index, total }) {
  if (!event) {
    return (
      <div className="selected-event-card">
        <p className="section-title">Selected event</p>
        <p className="placeholder">
          Press Next data once voice arm, tag verification, or handling events have been recorded.
        </p>
      </div>
    );
  }

  return (
    <div className="selected-event-card">
      <div className="chart-heading">
        <p className="section-title" style={{ marginTop: 0 }}>Selected event</p>
        <span className="tnum">
          {index + 1} / {total}
        </span>
      </div>
      <div className="selected-event-summary">
        <strong>{labelForEvent(event.eventType)}</strong>
        <span>{formatDateTime(event.receivedAt)}</span>
      </div>
      <pre>{JSON.stringify(event.payload, null, 2)}</pre>
    </div>
  );
}

function EventTimeline({ events, selectedEventId, onSelectEvent }) {
  return (
    <div className="timeline-block">
      <p className="section-title">Pick session timeline</p>
      {events.length > 0 ? (
        <div className="timeline-list">
          {events.map((event) => (
            <button
              className={`timeline-item ${selectedEventId === event.id ? "timeline-item-active" : ""}`}
              key={event.id}
              onClick={() => onSelectEvent?.(event)}
              type="button"
            >
              <span>{formatTime(event.receivedAt)}</span>
              <strong>{labelForEvent(event.eventType)}</strong>
              {event.payload?.movementClass ? <em>{event.payload.movementClass}</em> : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="placeholder">No pick events recorded yet for this session.</p>
      )}
    </div>
  );
}

function MovementChart({ samples }) {
  const chartSamples = samples
    .filter((sample) => typeof sample.movementConfidence === "number")
    .slice(-120);

  const points = chartSamples
    .map((sample, index) => {
      const x = chartSamples.length === 1 ? 0 : (index / (chartSamples.length - 1)) * 100;
      const y = 100 - Math.max(0, Math.min(1, sample.movementConfidence)) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <div className="chart-block">
      <div className="chart-heading">
        <p className="section-title" style={{ marginTop: 0 }}>Handling-motion confidence</p>
        <span>{chartSamples.length} samples</span>
      </div>
      {chartSamples.length > 0 ? (
        <>
          <div className="chart-frame">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1="0" x2="100" y1="0" y2="0" className="chart-axis-line" />
              <line x1="0" x2="100" y1="50" y2="50" className="chart-axis-line" />
              <line x1="0" x2="100" y1="100" y2="100" className="chart-axis-line" />
              <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
          <div className="direction-chips">
            {chartSamples.slice(-12).map((sample) => (
              <span key={sample.id}>
                {sample.direction ?? sample.movementClass ?? "unknown"}{" "}
                {typeof sample.movementConfidence === "number"
                  ? `${(sample.movementConfidence * 100).toFixed(0)}%`
                  : ""}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="placeholder">Handling-motion chart appears once the operator picks up the package.</p>
      )}
    </div>
  );
}

function getReplayEvents(events) {
  const replayEvents = [];
  let lastMovementLabel = "";

  for (const event of events) {
    if (event.eventType.endsWith("_debug")) {
      continue;
    }

    if (event.eventType === "movement") {
      const movementLabel =
        event.payload?.direction ?? event.payload?.movementClass ?? "movement";
      const hasMovement = replayEvents.some((item) => item.eventType === "movement");
      if (hasMovement && movementLabel === lastMovementLabel) {
        continue;
      }
      lastMovementLabel = movementLabel;
    }

    replayEvents.push(event);
    if (replayEvents.length >= 80) {
      break;
    }
  }

  return replayEvents;
}

function shortId(id) {
  return typeof id === "string" ? id.slice(0, 8) : "unknown";
}

function formatTime(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}
