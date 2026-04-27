"use client";

import { useEffect, useState } from "react";

const LATEST_POLL_INTERVAL_MS = 500;
const SESSION_POLL_INTERVAL_MS = 2000;

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
      const response = await fetch("/api/sessions/current/complete", {
        method: "POST",
        cache: "no-store"
      });
      const result = await response.json();

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

  return (
    <main className="dashboard-shell">
      <section className="hero-card">
        <p className="eyebrow">Nano 33 BLE Demo</p>
        <h1>Live event monitor</h1>
        <p className="hero-copy">
          Polling <code>/api/latest</code> every {LATEST_POLL_INTERVAL_MS} ms and storing every
          bridge event into recorded Postgres-backed demo sessions.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <p className="panel-label">Latest event</p>
          <p className="event-name">{latest?.event ?? "waiting_for_data"}</p>
          <p className="meta-line">Updated: {latest?.receivedAt ?? "No events received yet"}</p>
          {latest?.sessionId ? <p className="meta-line">Session: {shortId(latest.sessionId)}</p> : null}
          {latest?.colour ? <p className="meta-line">Colour: {latest.colour}</p> : null}
          {latest?.direction ? <p className="meta-line">Direction: {latest.direction}</p> : null}
          {latest?.movementClass ? (
            <p className="meta-line">
              Movement ML: {latest.movementClass}
              {movementConfidence !== null ? ` (${movementConfidence.toFixed(3)})` : ""}
            </p>
          ) : null}
          {greenConfidence !== null ? (
            <p className="meta-line">Green confidence: {greenConfidence.toFixed(3)}</p>
          ) : null}
          {latest?.topLabel ? (
            <p className="meta-line">
              Colour top: {latest.topLabel}
              {topConfidence !== null ? ` (${topConfidence.toFixed(3)})` : ""}
            </p>
          ) : null}
          {voiceStartConfidence !== null ? (
            <p className="meta-line">Voice start confidence: {voiceStartConfidence.toFixed(3)}</p>
          ) : null}
          {error ? <p className="error-line">Error: {error}</p> : null}
        </article>

        <article className="panel">
          <p className="panel-label">Movement data</p>
          {hasMovement ? (
            <>
              <div className="status-strip">
                <span>{latest.movementClass ?? "unknown"}</span>
                <strong>
                  {movementConfidence !== null ? `${(movementConfidence * 100).toFixed(1)}%` : "--"}
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
            <p className="placeholder">Movement values appear here once tracking starts.</p>
          )}
        </article>
      </section>

      <section className="session-layout">
        <article className="panel">
          <p className="panel-label">Recorded sessions</p>
          <div className="session-list-heading">
            <p className="session-count">{sessions.length} recent sessions</p>
            <button className="live-session-button" onClick={showLiveSession} type="button">
              Follow live
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
                  <span>
                    <strong>{formatTime(session.startedAt)}</strong>
                    <em>{shortId(session.id)}</em>
                  </span>
                  <span className={`status-pill status-${session.status}`}>{session.status}</span>
                  <small>
                    {session.eventCount} events · trigger {session.triggerEvent}
                  </small>
                </button>
              ))
            ) : (
              <p className="placeholder">Sessions will appear after the first board event.</p>
            )}
          </div>
        </article>

        <article className="panel session-detail-panel">
          <p className="panel-label">Session replay</p>
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
                  {stopPending ? "Ending..." : "End connection"}
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
                      ? "End connection saves only authenticated recordings and stops the bridge."
                      : "This session is not active.")}
                </p>
              </div>

              <MilestoneRow session={sessionDetail.session} />
              <SelectedEventCard event={selectedReplayEvent} index={selectedEventIndex} total={replayEvents.length} />
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
            <p className="placeholder">Select a session to inspect its recorded timeline.</p>
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

function MilestoneRow({ session }) {
  const milestones = [
    ["setup", session.startedAt],
    ["voice", session.voiceStartedAt],
    ["colour", session.colourAuthenticatedAt],
    ["movement", session.movementStartedAt]
  ];

  return (
    <div className="milestone-row">
      {milestones.map(([label, value]) => (
        <div className={value ? "milestone-hit" : "milestone-miss"} key={label}>
          <span>{label}</span>
          <strong>{value ? formatTime(value) : "waiting"}</strong>
        </div>
      ))}
    </div>
  );
}

function SelectedEventCard({ event, index, total }) {
  if (!event) {
    return (
      <div className="selected-event-card">
        <p className="section-title">Selected data</p>
        <p className="placeholder">Press Next data after voice, colour, or movement events arrive.</p>
      </div>
    );
  }

  return (
    <div className="selected-event-card">
      <div className="chart-heading">
        <p className="section-title">Selected data</p>
        <span>
          {index + 1} / {total}
        </span>
      </div>
      <div className="selected-event-summary">
        <strong>{event.eventType}</strong>
        <span>{formatDateTime(event.receivedAt)}</span>
      </div>
      <pre>{JSON.stringify(event.payload, null, 2)}</pre>
    </div>
  );
}

function EventTimeline({ events, selectedEventId, onSelectEvent }) {
  return (
    <div className="timeline-block">
      <p className="section-title">Event timeline</p>
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
              <strong>{event.eventType}</strong>
              {event.payload?.movementClass ? <em>{event.payload.movementClass}</em> : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="placeholder">Only debug events have been recorded so far.</p>
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
        <p className="section-title">Movement confidence</p>
        <span>{chartSamples.length} samples</span>
      </div>
      {chartSamples.length > 0 ? (
        <>
          <svg className="confidence-chart" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
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
        <p className="placeholder">Movement chart appears after tracking starts.</p>
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
    return "--";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}
