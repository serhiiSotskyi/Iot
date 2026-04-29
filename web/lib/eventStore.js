import { randomUUID } from "node:crypto";

import pg from "pg";

const { Pool } = pg;

const SESSION_IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_TIMEOUT_MS ?? 120000);
const DATABASE_URL = process.env.DATABASE_URL;

const memoryStore = globalThis.__iotDemoMemoryStore ?? {
  latestEvent: null,
  sessions: [],
  events: [],
  movementSamples: [],
  activeSessionId: null,
  pausedUntilSetup: false,
  bridgeStopRequested: false,
  nextEventId: 1,
  nextMovementId: 1
};

if (!globalThis.__iotDemoMemoryStore) {
  globalThis.__iotDemoMemoryStore = memoryStore;
}

const pgPool = DATABASE_URL
  ? globalThis.__iotDemoPgPool ?? new Pool({ connectionString: DATABASE_URL })
  : null;

if (pgPool && !globalThis.__iotDemoPgPool) {
  globalThis.__iotDemoPgPool = pgPool;
}

function assertMemoryFallbackAllowed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL must be set when NODE_ENV=production. " +
      "The in-memory fallback is for local development only."
    );
  }
}

export async function recordEvent(payload) {
  if (!pgPool) {
    assertMemoryFallbackAllowed();
    return recordEventInMemory(payload);
  }

  return recordEventInPostgres(payload);
}

export async function completeCurrentSession() {
  if (!pgPool) {
    assertMemoryFallbackAllowed();
    return completeCurrentSessionInMemory();
  }

  return completeCurrentSessionInPostgres();
}

export async function consumeBridgeControlState() {
  if (!pgPool) {
    assertMemoryFallbackAllowed();
    const stopBridge = memoryStore.bridgeStopRequested;
    memoryStore.bridgeStopRequested = false;
    return { stopBridge };
  }

  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await ensureRecordingState(client);
    const result = await client.query(
      `SELECT stop_bridge_requested
       FROM recording_state
       WHERE id = 1
       FOR UPDATE`
    );
    const stopBridge = result.rows[0]?.stop_bridge_requested === true;
    if (stopBridge) {
      await client.query(
        `UPDATE recording_state
         SET stop_bridge_requested = false, updated_at = now()
         WHERE id = 1`
      );
    }
    await client.query("COMMIT");
    return { stopBridge };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getLatestEvent() {
  if (!pgPool) {
    assertMemoryFallbackAllowed();
    return memoryStore.latestEvent;
  }

  const result = await pgPool.query(
    `SELECT session_id, payload, received_at
     FROM events
     ORDER BY id DESC
     LIMIT 1`
  );

  if (result.rowCount === 0) {
    return null;
  }

  return normalizeLatestEvent(
    result.rows[0].payload,
    result.rows[0].received_at,
    result.rows[0].session_id
  );
}

export async function listSessions(limit = 20) {
  if (!pgPool) {
    assertMemoryFallbackAllowed();
    return memoryStore.sessions
      .slice()
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, limit)
      .map((session) => ({
        ...session,
        latestEvent: getLatestEventForMemorySession(session.id)
      }));
  }

  const result = await pgPool.query(
    `SELECT
       s.*,
       latest.payload AS latest_payload,
       latest.received_at AS latest_received_at
     FROM sessions s
     LEFT JOIN LATERAL (
       SELECT payload, received_at
       FROM events e
       WHERE e.session_id = s.id
       ORDER BY e.id DESC
       LIMIT 1
     ) latest ON true
     ORDER BY s.started_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => ({
    ...normalizeSession(row),
    latestEvent: row.latest_payload
      ? normalizeLatestEvent(row.latest_payload, row.latest_received_at, row.id)
      : null
  }));
}

export async function getSessionDetail(id) {
  if (!pgPool) {
    assertMemoryFallbackAllowed();
    const session = memoryStore.sessions.find((item) => item.id === id);
    if (!session) {
      return null;
    }

    return {
      session,
      events: memoryStore.events
        .filter((event) => event.sessionId === id)
        .sort((a, b) => Number(a.id) - Number(b.id)),
      movementSamples: memoryStore.movementSamples
        .filter((sample) => sample.sessionId === id)
        .sort((a, b) => Number(a.id) - Number(b.id))
    };
  }

  const sessionResult = await pgPool.query("SELECT * FROM sessions WHERE id = $1", [id]);
  if (sessionResult.rowCount === 0) {
    return null;
  }

  const eventsResult = await pgPool.query(
    `SELECT id, session_id, event_type, payload, received_at
     FROM events
     WHERE session_id = $1
     ORDER BY id ASC
     LIMIT 500`,
    [id]
  );

  const movementResult = await pgPool.query(
    `SELECT *
     FROM movement_samples
     WHERE session_id = $1
     ORDER BY id ASC
     LIMIT 1000`,
    [id]
  );

  return {
    session: normalizeSession(sessionResult.rows[0]),
    events: eventsResult.rows.map(normalizeEventRow),
    movementSamples: movementResult.rows.map(normalizeMovementSampleRow)
  };
}

async function recordEventInPostgres(payload) {
  const client = await pgPool.connect();
  const receivedAt = new Date();
  const receivedAtIso = receivedAt.toISOString();

  try {
    await client.query("BEGIN");

    await ensureRecordingState(client);
    const pausedUntilSetup = await getPausedUntilSetupForUpdate(client);
    if (pausedUntilSetup && payload.event !== "setup_status") {
      await client.query("COMMIT");
      return {
        latest: await getLatestEvent(),
        session: null,
        ignored: true,
        reason: "recording_paused_until_setup",
        stopBridge: true
      };
    }

    if (payload.event === "setup_status" && pausedUntilSetup) {
      await setPausedUntilSetup(client, false);
      await setBridgeStopRequested(client, false);
    }

    let session = await getActiveSessionForUpdate(client);
    const shouldCloseForReset = payload.event === "setup_status" && session;
    const shouldCloseForIdle =
      session &&
      receivedAt.getTime() - new Date(session.last_event_at).getTime() > SESSION_IDLE_TIMEOUT_MS;

    if (shouldCloseForReset || shouldCloseForIdle) {
      if (sessionHasRequiredAuthentication(session)) {
        await client.query(
          `UPDATE sessions
           SET status = $1, ended_at = $2
           WHERE id = $3`,
          [shouldCloseForReset ? "completed" : "abandoned", receivedAtIso, session.id]
        );
      } else {
        await deleteSession(client, session.id);
      }
      session = null;
    }

    if (!session) {
      session = await createSession(client, payload.event, receivedAtIso, payload);
    }

    const eventResult = await client.query(
      `INSERT INTO events (session_id, event_type, payload, received_at)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id`,
      [session.id, payload.event, JSON.stringify(payload), receivedAtIso]
    );

    const eventId = eventResult.rows[0].id;
    if (payload.event === "movement") {
      await insertMovementSample(client, session.id, eventId, payload, receivedAtIso);
    }

    const updatedSessionResult = await client.query(
      `UPDATE sessions
       SET
         event_count = event_count + 1,
         last_event_at = $2,
         voice_started_at = CASE WHEN $3::boolean THEN COALESCE(voice_started_at, $2) ELSE voice_started_at END,
         colour_authenticated_at = CASE WHEN $4::boolean THEN COALESCE(colour_authenticated_at, $2) ELSE colour_authenticated_at END,
         movement_started_at = CASE WHEN $5::boolean THEN COALESCE(movement_started_at, $2) ELSE movement_started_at END
       WHERE id = $1
       RETURNING *`,
      [
        session.id,
        receivedAtIso,
        payload.event === "voice_start",
        payload.event === "colour_authenticated",
        payload.event === "movement"
      ]
    );

    await client.query("COMMIT");

    const latest = normalizeLatestEvent(payload, receivedAtIso, session.id);
    return {
      latest,
      session: normalizeSession(updatedSessionResult.rows[0])
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeCurrentSessionInPostgres() {
  const client = await pgPool.connect();
  const receivedAt = new Date().toISOString();
  const completePayload = {
    event: "session_complete",
    source: "dashboard"
  };

  try {
    await client.query("BEGIN");
    await ensureRecordingState(client);

    const session = await getActiveSessionForUpdate(client);
    if (!session) {
      await setPausedUntilSetup(client, true);
      await setBridgeStopRequested(client, true);
      await client.query("COMMIT");
      return {
        completed: false,
        reason: "no_active_session",
        session: null,
        latest: await getLatestEvent(),
        stopBridge: true
      };
    }

    const missingAuthentication = getMissingAuthenticationSteps(session);
    if (missingAuthentication.length > 0) {
      await deleteSession(client, session.id);
      await setPausedUntilSetup(client, true);
      await setBridgeStopRequested(client, true);
      await client.query("COMMIT");

      return {
        completed: false,
        deleted: true,
        reason: "authentication_incomplete",
        missing: missingAuthentication,
        session: null,
        latest: await getLatestEvent(),
        stopBridge: true
      };
    }

    const eventResult = await client.query(
      `INSERT INTO events (session_id, event_type, payload, received_at)
       VALUES ($1, 'session_complete', $2::jsonb, $3)
       RETURNING id`,
      [session.id, JSON.stringify(completePayload), receivedAt]
    );

    const updatedSessionResult = await client.query(
      `UPDATE sessions
       SET
         status = 'completed',
         ended_at = $2,
         last_event_at = $2,
         event_count = event_count + 1
       WHERE id = $1
       RETURNING *`,
      [session.id, receivedAt]
    );

    await setPausedUntilSetup(client, true);
    await setBridgeStopRequested(client, true);
    await client.query("COMMIT");

    return {
      completed: true,
      eventId: String(eventResult.rows[0].id),
      latest: normalizeLatestEvent(completePayload, receivedAt, session.id),
      session: normalizeSession(updatedSessionResult.rows[0]),
      stopBridge: true
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureRecordingState(client) {
  await client.query(
    `ALTER TABLE recording_state
     ADD COLUMN IF NOT EXISTS stop_bridge_requested boolean NOT NULL DEFAULT false`
  );
  await client.query(
    `INSERT INTO recording_state (id, paused_until_setup, stop_bridge_requested)
     VALUES (1, false, false)
     ON CONFLICT (id) DO NOTHING`
  );
}

async function getPausedUntilSetupForUpdate(client) {
  const result = await client.query(
    `SELECT paused_until_setup
     FROM recording_state
     WHERE id = 1
     FOR UPDATE`
  );

  return result.rows[0]?.paused_until_setup === true;
}

async function setPausedUntilSetup(client, paused) {
  await client.query(
    `UPDATE recording_state
     SET paused_until_setup = $1, updated_at = now()
     WHERE id = 1`,
    [paused]
  );
}

async function setBridgeStopRequested(client, requested) {
  await client.query(
    `UPDATE recording_state
     SET stop_bridge_requested = $1, updated_at = now()
     WHERE id = 1`,
    [requested]
  );
}

async function getActiveSessionForUpdate(client) {
  const result = await client.query(
    `SELECT *
     FROM sessions
     WHERE id = (
       SELECT id
       FROM sessions
       WHERE status = 'active'
       ORDER BY last_event_at DESC
       LIMIT 1
     )
     FOR UPDATE`
  );

  return result.rows[0] ?? null;
}

async function createSession(client, triggerEvent, receivedAtIso, payload) {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO sessions (
       id,
       started_at,
       status,
       trigger_event,
       last_event_at,
       metadata
     )
     VALUES ($1, $2, 'active', $3, $2, $4::jsonb)
     RETURNING *`,
    [
      id,
      receivedAtIso,
      triggerEvent,
      JSON.stringify({
        initialState: payload.state ?? null,
        source: "serial_bridge"
      })
    ]
  );

  return result.rows[0];
}

async function deleteSession(client, sessionId) {
  await client.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
}

async function insertMovementSample(client, sessionId, eventId, payload, receivedAtIso) {
  await client.query(
    `INSERT INTO movement_samples (
       session_id,
       event_id,
       received_at,
       ax,
       ay,
       az,
       gx,
       gy,
       gz,
       movement_class,
       movement_confidence,
       direction
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      sessionId,
      eventId,
      receivedAtIso,
      numberOrNull(payload.ax),
      numberOrNull(payload.ay),
      numberOrNull(payload.az),
      numberOrNull(payload.gx),
      numberOrNull(payload.gy),
      numberOrNull(payload.gz),
      stringOrNull(payload.movementClass),
      numberOrNull(payload.movementConfidence),
      stringOrNull(payload.direction)
    ]
  );
}

function recordEventInMemory(payload) {
  const receivedAt = new Date();
  const receivedAtIso = receivedAt.toISOString();

  if (memoryStore.pausedUntilSetup && payload.event !== "setup_status") {
    return {
      latest: memoryStore.latestEvent,
      session: null,
      ignored: true,
      reason: "recording_paused_until_setup",
      stopBridge: true
    };
  }

  if (payload.event === "setup_status") {
    memoryStore.pausedUntilSetup = false;
    memoryStore.bridgeStopRequested = false;
  }

  let session = memoryStore.sessions.find((item) => item.id === memoryStore.activeSessionId);
  const shouldCloseForReset = payload.event === "setup_status" && session;
  const shouldCloseForIdle =
    session &&
    receivedAt.getTime() - Date.parse(session.lastEventAt) > SESSION_IDLE_TIMEOUT_MS;

  if (shouldCloseForReset || shouldCloseForIdle) {
    if (sessionHasRequiredAuthentication(session)) {
      session.status = shouldCloseForReset ? "completed" : "abandoned";
      session.endedAt = receivedAtIso;
    } else {
      deleteMemorySession(session.id);
    }
    memoryStore.activeSessionId = null;
    session = null;
  }

  if (!session) {
    session = {
      id: randomUUID(),
      startedAt: receivedAtIso,
      endedAt: null,
      status: "active",
      triggerEvent: payload.event,
      lastEventAt: receivedAtIso,
      eventCount: 0,
      voiceStartedAt: null,
      colourAuthenticatedAt: null,
      movementStartedAt: null,
      metadata: {
        initialState: payload.state ?? null,
        source: "memory_fallback"
      }
    };
    memoryStore.sessions.push(session);
    memoryStore.activeSessionId = session.id;
  }

  const event = {
    id: String(memoryStore.nextEventId++),
    sessionId: session.id,
    eventType: payload.event,
    payload,
    receivedAt: receivedAtIso
  };

  memoryStore.events.push(event);

  if (payload.event === "movement") {
    memoryStore.movementSamples.push({
      id: String(memoryStore.nextMovementId++),
      sessionId: session.id,
      eventId: event.id,
      receivedAt: receivedAtIso,
      ax: numberOrNull(payload.ax),
      ay: numberOrNull(payload.ay),
      az: numberOrNull(payload.az),
      gx: numberOrNull(payload.gx),
      gy: numberOrNull(payload.gy),
      gz: numberOrNull(payload.gz),
      movementClass: stringOrNull(payload.movementClass),
      movementConfidence: numberOrNull(payload.movementConfidence),
      direction: stringOrNull(payload.direction)
    });
  }

  session.eventCount += 1;
  session.lastEventAt = receivedAtIso;
  if (payload.event === "voice_start") {
    session.voiceStartedAt ??= receivedAtIso;
  }
  if (payload.event === "colour_authenticated") {
    session.colourAuthenticatedAt ??= receivedAtIso;
  }
  if (payload.event === "movement") {
    session.movementStartedAt ??= receivedAtIso;
  }

  const latest = normalizeLatestEvent(payload, receivedAtIso, session.id);
  memoryStore.latestEvent = latest;

  return {
    latest,
    session
  };
}

function completeCurrentSessionInMemory() {
  const receivedAtIso = new Date().toISOString();
  const session = memoryStore.sessions.find((item) => item.id === memoryStore.activeSessionId);

  memoryStore.pausedUntilSetup = true;
  memoryStore.bridgeStopRequested = true;

  if (!session) {
    return {
      completed: false,
      reason: "no_active_session",
      session: null,
      latest: memoryStore.latestEvent,
      stopBridge: true
    };
  }

  const missingAuthentication = getMissingAuthenticationSteps(session);
  if (missingAuthentication.length > 0) {
    const deletedSessionId = session.id;
    deleteMemorySession(deletedSessionId);
    memoryStore.activeSessionId = null;
    if (memoryStore.latestEvent?.sessionId === deletedSessionId) {
      memoryStore.latestEvent = getLatestMemoryEvent();
    }

    return {
      completed: false,
      deleted: true,
      reason: "authentication_incomplete",
      missing: missingAuthentication,
      session: null,
      latest: memoryStore.latestEvent,
      stopBridge: true
    };
  }

  const payload = {
    event: "session_complete",
    source: "dashboard"
  };
  const event = {
    id: String(memoryStore.nextEventId++),
    sessionId: session.id,
    eventType: payload.event,
    payload,
    receivedAt: receivedAtIso
  };

  memoryStore.events.push(event);
  session.status = "completed";
  session.endedAt = receivedAtIso;
  session.lastEventAt = receivedAtIso;
  session.eventCount += 1;
  memoryStore.activeSessionId = null;

  const latest = normalizeLatestEvent(payload, receivedAtIso, session.id);
  memoryStore.latestEvent = latest;

  return {
    completed: true,
    eventId: event.id,
    latest,
    session,
    stopBridge: true
  };
}

function sessionHasRequiredAuthentication(session) {
  return (
    Boolean(session.voice_started_at ?? session.voiceStartedAt) &&
    Boolean(session.colour_authenticated_at ?? session.colourAuthenticatedAt)
  );
}

function getMissingAuthenticationSteps(session) {
  const missing = [];
  if (!Boolean(session.voice_started_at ?? session.voiceStartedAt)) {
    missing.push("voice_start");
  }
  if (!Boolean(session.colour_authenticated_at ?? session.colourAuthenticatedAt)) {
    missing.push("colour_authenticated");
  }

  return missing;
}

function deleteMemorySession(sessionId) {
  memoryStore.sessions = memoryStore.sessions.filter((item) => item.id !== sessionId);
  memoryStore.events = memoryStore.events.filter((item) => item.sessionId !== sessionId);
  memoryStore.movementSamples = memoryStore.movementSamples.filter(
    (item) => item.sessionId !== sessionId
  );
}

function getLatestMemoryEvent() {
  const event = memoryStore.events.at(-1);
  if (!event) {
    return null;
  }

  return normalizeLatestEvent(event.payload, event.receivedAt, event.sessionId);
}

function normalizeSession(row) {
  return {
    id: row.id,
    startedAt: toIso(row.started_at),
    endedAt: toIso(row.ended_at),
    status: row.status,
    triggerEvent: row.trigger_event,
    lastEventAt: toIso(row.last_event_at),
    eventCount: row.event_count,
    voiceStartedAt: toIso(row.voice_started_at),
    colourAuthenticatedAt: toIso(row.colour_authenticated_at),
    movementStartedAt: toIso(row.movement_started_at),
    metadata: row.metadata ?? {}
  };
}

function normalizeEventRow(row) {
  return {
    id: String(row.id),
    sessionId: row.session_id,
    eventType: row.event_type,
    payload: row.payload,
    receivedAt: toIso(row.received_at)
  };
}

function normalizeMovementSampleRow(row) {
  return {
    id: String(row.id),
    sessionId: row.session_id,
    eventId: String(row.event_id),
    receivedAt: toIso(row.received_at),
    ax: numberOrNull(row.ax),
    ay: numberOrNull(row.ay),
    az: numberOrNull(row.az),
    gx: numberOrNull(row.gx),
    gy: numberOrNull(row.gy),
    gz: numberOrNull(row.gz),
    movementClass: stringOrNull(row.movement_class),
    movementConfidence: numberOrNull(row.movement_confidence),
    direction: stringOrNull(row.direction)
  };
}

function normalizeLatestEvent(payload, receivedAt, sessionId) {
  return {
    ...payload,
    sessionId,
    receivedAt: toIso(receivedAt)
  };
}

function getLatestEventForMemorySession(sessionId) {
  const event = memoryStore.events
    .filter((item) => item.sessionId === sessionId)
    .at(-1);

  if (!event) {
    return null;
  }

  return normalizeLatestEvent(event.payload, event.receivedAt, sessionId);
}

function toIso(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
