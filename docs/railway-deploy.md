# Railway Deployment

This is the simplest always-on hosting path for `nitpickr` today:

- one Railway `api` service
- one Railway `worker` service
- one Railway Postgres database

Local Docker Compose remains the development path. Railway is the hosted runtime.

## What This Deploys

- `api`: public HTTPS webhook endpoint for GitHub
- `worker`: private background reviewer process
- `postgres`: queue, review state, memory, and setup state

Both services can safely run the same pre-deploy migration command because migrations now use a PostgreSQL advisory lock.

## 1. Create the Railway Project

Create one Railway project and add:

1. A PostgreSQL database
2. A service from this repo for the API
3. A second service from this repo for the worker

Use the same repository for both services.

## 2. Configure Each Railway Service

For the API service, set the config-as-code path to:

`deploy/railway/api.toml`

For the worker service, set the config-as-code path to:

`deploy/railway/worker.toml`

Those files do three things:

- build from the existing `Dockerfile`
- run `node dist/src/cli/index.js migrate` before each deploy
- start the correct process for each service

## 3. Set Environment Variables

Set these shared environment variables on both services:

- `DATABASE_URL`
  - use the Railway Postgres connection string
- `NITPICKR_BASE_URL`
  - the public Railway URL for the API service, for example `https://nitpickr-api-production.up.railway.app`
- `NITPICKR_SECRET_KEY`
  - generate a long random secret, for example `openssl rand -hex 32`
- `NITPICKR_LOG_LEVEL`
  - `info` is a good default
- `NITPICKR_WORKER_CONCURRENCY`
  - keep `4` unless you need more throughput
- `NITPICKR_WORKER_POLL_INTERVAL_MS`
  - keep `5000` unless you need faster polling

Set these runtime secrets as Railway environment variables too:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_BOT_LOGINS`

You can keep `OPENAI_BASE_URL` and `GITHUB_API_BASE_URL` at their defaults unless you are using stubs.

## 4. Use the Railway URL for GitHub Webhooks

Point the GitHub App webhook URL to:

`https://YOUR_PUBLIC_RAILWAY_DOMAIN/webhooks/github`

Use the same webhook secret value in:

- Railway `GITHUB_WEBHOOK_SECRET`
- the GitHub App webhook configuration

Repository permissions should be:

- Pull requests: Read and write
- Contents: Read-only
- Issues: Read and write
- Checks: Read and write
- Metadata: Read-only

Webhook events should include:

- Pull request
- Issue comment

## 5. Health and Monitoring

The Railway API service healthcheck uses `/healthz` for deploy safety.

Use `/readyz` for external uptime checks because it verifies:

- database connectivity
- runtime setup status
- fresh worker heartbeat

That means `/readyz` is better for alerting, but it is too strict for the API service's own deploy healthcheck.

## 6. Auto-Deploy on Merge to `main`

The simplest deployment model is Railway's built-in GitHub auto-deploy:

- connect both services to this repository
- set the production branch to `main`
- enable automatic deploys

Then every merge to `main` rebuilds and redeploys:

- `api`
- `worker`

No extra GitHub Actions deploy workflow is required for the first hosted version.

## 7. First Verification

After the first deploy:

1. Open `https://YOUR_PUBLIC_RAILWAY_DOMAIN/healthz`
2. Confirm it returns `{"ok":true}`
3. Open `https://YOUR_PUBLIC_RAILWAY_DOMAIN/readyz`
4. Confirm it becomes ready after the worker starts
5. Open a PR and comment `@getnitpickr review`
6. Watch Railway logs for the API and worker services

## Notes

- Railway is the recommended hosted alpha path because it removes the laptop and `ngrok` from the runtime chain.
- Docker Compose is still the local development path and should stay that way for now.
- If you outgrow Railway later, the existing Dockerfile and split `api` / `worker` model will make migration straightforward.
