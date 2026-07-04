-- Runtime operations tables: board sessions, dead-letter queue, and security-scale primitives.
-- Carries pre-OLF migrations 0006_security_scale + 0007_action_runtime + 0009_runtime_ops.
-- Governance tables (decision_logs, approvals) are already present in 0001_core.sql.

create table if not exists workspace_memberships (
  workspace_id text not null,
  user_id text not null,
  role text not null check (role in ('admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists request_idempotency_keys (
  workspace_id text not null,
  scope text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, scope, idempotency_key)
);

create index if not exists idx_request_idempotency_keys_created_at
  on request_idempotency_keys(created_at desc);

create table if not exists distributed_locks (
  workspace_id text not null,
  resource text not null,
  owner_id text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (workspace_id, resource)
);

create index if not exists idx_distributed_locks_expires
  on distributed_locks(expires_at asc);

create table if not exists action_requests (
  id text primary key,
  workspace_id text not null,
  project_id text,
  initiator text not null,
  mode text not null check (mode in ('SIM', 'LIVE')),
  type text not null,
  payload jsonb not null,
  policy_tags jsonb not null default '[]'::jsonb,
  requires_approval text not null check (requires_approval in ('AUTO', 'CEO_APPROVAL', 'MULTI_APPROVAL')),
  status text not null check (status in ('REQUESTED', 'QUEUED', 'SIMULATED', 'EXECUTED', 'FAILED', 'DENIED')),
  approval_state text not null check (approval_state in ('PENDING', 'APPROVED', 'DENIED', 'N/A')),
  output jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  confidence double precision,
  artifact_refs jsonb not null default '[]'::jsonb,
  linked_action_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists action_requests_workspace_created_idx
  on action_requests (workspace_id, created_at desc);

create index if not exists action_requests_workspace_status_idx
  on action_requests (workspace_id, status);

create table if not exists action_ledger (
  id text primary key,
  workspace_id text not null,
  action_request_id text not null,
  event_type text not null check (event_type in ('REQUESTED', 'QUEUED', 'SIMULATED', 'EXECUTED', 'FAILED', 'DENIED', 'APPROVED')),
  event_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists action_ledger_workspace_created_idx
  on action_ledger (workspace_id, created_at desc);

create table if not exists board_meetings (
  id uuid primary key,
  workspace_id text not null,
  project_id text,
  title text not null,
  agenda text not null,
  desired_decision text,
  participants jsonb not null default '[]'::jsonb,
  status text not null check (status in ('open', 'closed')),
  decision jsonb,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists idx_board_meetings_workspace_created
  on board_meetings(workspace_id, created_at desc);

create table if not exists board_meeting_messages (
  id uuid primary key,
  workspace_id text not null,
  meeting_id uuid not null references board_meetings(id) on delete cascade,
  author_type text not null check (author_type in ('OPERATOR', 'AGENT')),
  author_id text not null,
  content text not null,
  structured_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_board_meeting_messages_meeting_created
  on board_meeting_messages(meeting_id, created_at asc);

create table if not exists executive_sessions (
  id uuid primary key,
  workspace_id text not null,
  project_id text,
  executive_agent text not null,
  status text not null check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists idx_executive_sessions_workspace_created
  on executive_sessions(workspace_id, created_at desc);

create table if not exists executive_session_messages (
  id uuid primary key,
  workspace_id text not null,
  session_id uuid not null references executive_sessions(id) on delete cascade,
  author_type text not null check (author_type in ('OPERATOR', 'AGENT')),
  author_id text not null,
  content text not null,
  structured_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_exec_session_messages_session_created
  on executive_session_messages(session_id, created_at asc);

create table if not exists dead_letters (
  id uuid primary key,
  workspace_id text not null,
  source text not null,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dead_letters_workspace_created
  on dead_letters(workspace_id, created_at desc);
