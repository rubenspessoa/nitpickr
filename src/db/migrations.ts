export const migrations = [
  `
    create table if not exists jobs (
      id text primary key,
      type text not null,
      tenant_id text not null,
      repository_id text not null,
      change_request_id text,
      dedupe_key text not null,
      priority integer not null,
      status text not null,
      attempts integer not null,
      max_attempts integer not null,
      payload jsonb not null,
      created_at timestamptz not null,
      scheduled_at timestamptz not null,
      started_at timestamptz,
      completed_at timestamptz,
      worker_id text,
      last_error text
    );

    create index if not exists jobs_queue_idx on jobs (status, priority desc, scheduled_at asc);
    create index if not exists jobs_tenant_idx on jobs (tenant_id, status);
  `,
  `
    create table if not exists memories (
      id text primary key,
      tenant_id text not null,
      repository_id text not null,
      kind text not null,
      summary text not null,
      path text,
      confidence double precision not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create index if not exists memories_repo_idx on memories (tenant_id, repository_id);
  `,
  `
    create table if not exists change_requests (
      id text primary key,
      tenant_id text not null,
      installation_id text not null,
      repository_id text not null,
      provider text not null,
      number integer not null,
      title text not null,
      base_sha text not null,
      head_sha text not null,
      status text not null,
      author_login text not null,
      updated_at timestamptz not null
    );

    create index if not exists change_requests_repo_idx on change_requests (tenant_id, repository_id, number desc);
  `,
  `
    create table if not exists review_runs (
      id text primary key,
      tenant_id text not null,
      repository_id text not null,
      change_request_id text not null references change_requests (id),
      trigger jsonb not null,
      mode text not null,
      scope text not null default 'full_pr',
      head_sha text not null,
      compared_from_sha text,
      status text not null,
      budgets jsonb not null,
      summary text,
      mermaid text,
      published_review_id text,
      failure_reason text,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      completed_at timestamptz
    );

    create index if not exists review_runs_lookup_idx on review_runs (tenant_id, repository_id, change_request_id, created_at desc);
  `,
  `
    create table if not exists review_findings (
      id text primary key,
      review_run_id text not null references review_runs (id),
      repository_id text not null,
      path text not null,
      line integer not null,
      finding_type text not null default 'bug',
      severity text not null,
      category text not null,
      title text not null,
      body text not null,
      fix_prompt text not null,
      created_at timestamptz not null
    );

    create index if not exists review_findings_run_idx on review_findings (review_run_id, severity);
  `,
  `
    create table if not exists published_comments (
      id text primary key,
      review_run_id text not null references review_runs (id),
      published_review_id text not null,
      path text not null,
      line integer not null,
      body text not null,
      provider_thread_id text,
      provider_comment_id text,
      fingerprint text,
      resolved_at timestamptz,
      created_at timestamptz not null
    );

    create index if not exists published_comments_run_idx on published_comments (review_run_id);
  `,
  `
    create table if not exists discussion_events (
      id text primary key,
      tenant_id text not null,
      repository_id text not null,
      change_request_id text not null references change_requests (id),
      author_login text not null,
      body text not null,
      path text,
      line integer,
      source text not null,
      provider_created_at timestamptz not null,
      created_at timestamptz not null
    );

    create index if not exists discussion_events_repo_idx on discussion_events (tenant_id, repository_id, change_request_id, provider_created_at desc);
  `,
  `
    alter table review_findings
    add column if not exists suggested_change text;
  `,
  `
    alter table review_runs
    add column if not exists check_run_id text;
  `,
  `
    alter table review_runs
    add column if not exists scope text not null default 'full_pr';

    alter table review_runs
    add column if not exists compared_from_sha text;
  `,
  `
    alter table review_findings
    add column if not exists finding_type text not null default 'bug';
  `,
  `
    alter table published_comments
    add column if not exists provider_thread_id text;

    alter table published_comments
    add column if not exists provider_comment_id text;

    alter table published_comments
    add column if not exists fingerprint text;

    alter table published_comments
    add column if not exists resolved_at timestamptz;
  `,
  `
    create table if not exists app_runtime_config (
      singleton_key text primary key,
      encrypted_runtime_secrets text,
      updated_at timestamptz not null
    );
  `,
  `
    create table if not exists worker_heartbeats (
      worker_id text primary key,
      status text not null,
      last_seen_at timestamptz not null,
      updated_at timestamptz not null
    );
  `,
  `
    create table if not exists webhook_events (
      delivery_id text primary key,
      provider text not null,
      event_name text not null,
      status text not null,
      repository_id text,
      change_request_id text,
      payload jsonb,
      error_message text,
      received_at timestamptz not null,
      updated_at timestamptz not null
    );

    create index if not exists webhook_events_status_idx on webhook_events (provider, status, updated_at desc);
  `,
  `
    create table if not exists review_feedback_events (
      id text primary key,
      tenant_id text not null,
      repository_id text not null,
      scope_key text not null,
      provider_comment_id text,
      fingerprint text,
      path text,
      category text,
      finding_type text,
      kind text not null,
      count integer not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create unique index if not exists review_feedback_events_scope_idx
      on review_feedback_events (repository_id, scope_key, kind);

    create index if not exists review_feedback_events_repo_idx
      on review_feedback_events (tenant_id, repository_id, updated_at desc);
  `,
];
