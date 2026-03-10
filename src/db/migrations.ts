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
      head_sha text not null,
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
];
