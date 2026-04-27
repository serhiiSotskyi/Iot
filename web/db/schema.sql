CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  status text NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
  trigger_event text NOT NULL,
  last_event_at timestamptz NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  voice_started_at timestamptz,
  colour_authenticated_at timestamptz,
  movement_started_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS movement_samples (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL,
  ax double precision,
  ay double precision,
  az double precision,
  gx double precision,
  gy double precision,
  gz double precision,
  movement_class text,
  movement_confidence double precision,
  direction text
);

CREATE TABLE IF NOT EXISTS recording_state (
  id integer PRIMARY KEY CHECK (id = 1),
  paused_until_setup boolean NOT NULL DEFAULT false,
  stop_bridge_requested boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recording_state
  ADD COLUMN IF NOT EXISTS stop_bridge_requested boolean NOT NULL DEFAULT false;

INSERT INTO recording_state (id, paused_until_setup, stop_bridge_requested)
VALUES (1, false, false)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS sessions_status_last_event_idx
  ON sessions (status, last_event_at DESC);

CREATE INDEX IF NOT EXISTS events_session_received_idx
  ON events (session_id, received_at ASC);

CREATE INDEX IF NOT EXISTS events_received_idx
  ON events (received_at DESC);

CREATE INDEX IF NOT EXISTS movement_samples_session_received_idx
  ON movement_samples (session_id, received_at ASC);
