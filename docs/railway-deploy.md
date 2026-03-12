# Railway deployment

Railway is the easiest always-on hosting path for `nitpickr` today.

Recommended deployment shape:

- one public `api` service
- one private `worker` service
- one PostgreSQL database

Local Docker Compose is still the lowest-cost path. Use Railway when you want a
stable webhook endpoint without running the stack on your own machine.

Official Railway references:

- [Config as code](https://docs.railway.com/reference/config-as-code)
- [Variables](https://docs.railway.com/reference/variables)
- [Public networking](https://docs.railway.com/reference/public-networking)
- [Pricing](https://railway.com/pricing)

## Cost note

Railway's plans and free-tier/trial limits change over time, so check the
current pricing page before you depend on a hosted setup. In practice, the
platform is usually sufficient for small personal testing and early indie use,
but the cheapest ongoing option is still:

- local Docker Compose
- plus a low-cost or free HTTPS tunnel
- plus your OpenAI usage

## 1. Create the Railway project

Create one Railway project and add:

1. a PostgreSQL database
2. an `api` service from this repository
3. a `worker` service from this repository

Use the same repository for both services.

## 2. Point each service at the checked-in config

For the API service, set the config-as-code path to:

`deploy/railway/api.toml`

For the worker service, set the config-as-code path to:

`deploy/railway/worker.toml`

Those files already:

- build from the repository `Dockerfile`
- run `node dist/src/cli/index.js migrate` before each deploy
- start the correct runtime command for each service

## 3. Expose only the API service publicly

Enable public networking for the API service and keep the worker private.

You need the API service's public domain for:

- `NITPICKR_BASE_URL`
- `NITPICKR_WEBHOOK_URL`
- the GitHub App webhook URL

## 4. Configure environment variables

Set these shared values across both services:

| Variable | Value |
| --- | --- |
| `NITPICKR_SECRET_KEY` | Generate with `openssl rand -hex 32` |
| `OPENAI_API_KEY` | Your OpenAI API key |
| `OPENAI_MODEL` | Start with `gpt-5-mini` |
| `GITHUB_APP_ID` | The numeric GitHub App ID |
| `GITHUB_PRIVATE_KEY` | The GitHub App PEM private key |
| `GITHUB_WEBHOOK_SECRET` | The same webhook secret configured in the GitHub App |
| `GITHUB_BOT_LOGINS` | Comma-separated mention handles without `@` |
| `NITPICKR_LOG_LEVEL` | Usually `info` |
| `NITPICKR_WORKER_CONCURRENCY` | Usually `4` |
| `NITPICKR_WORKER_POLL_INTERVAL_MS` | Usually `5000` |

Set these service values as well:

| Variable | API | Worker |
| --- | --- | --- |
| `DATABASE_URL` | Railway Postgres reference | Railway Postgres reference |
| `NITPICKR_BASE_URL` | `https://<api-public-domain>` | same value as API |
| `NITPICKR_WEBHOOK_URL` | `https://<api-public-domain>/webhooks/github` | same value as API |

Notes:

- `NITPICKR_BASE_URL` should point to the public API domain, not the worker.
- `NITPICKR_WEBHOOK_URL` is redundant at runtime when `NITPICKR_BASE_URL` is
  set, but it keeps the environment explicit and matches `pnpm cli doctor`.
- `OPENAI_BASE_URL` and `GITHUB_API_BASE_URL` can stay on their defaults unless
  you are using custom proxies or stubs.

## 5. Wire the GitHub App to Railway

In the GitHub App settings:

- set the webhook URL to
  `https://YOUR_PUBLIC_RAILWAY_DOMAIN/webhooks/github`
- use the same value for `GITHUB_WEBHOOK_SECRET`
- make sure the app is installed on the repositories you want reviewed

For the GitHub-side setup details, use [docs/github-app.md](github-app.md).

## 6. Deploy

Railway can auto-deploy on pushes to your chosen branch.

The simplest setup is:

- connect both services to this repository
- choose the production branch
- enable automatic deploys

Every deploy will:

- build the image
- run migrations with the advisory-lock protected migrate command
- start the API or worker process

## 7. Verify the deployment

After the first deploy:

1. Open `https://YOUR_PUBLIC_RAILWAY_DOMAIN/healthz`
2. Confirm it returns `{"ok":true}`
3. Open `https://YOUR_PUBLIC_RAILWAY_DOMAIN/readyz`
4. Wait for it to become ready after the worker starts
5. Install the GitHub App on a repository
6. Open a PR and comment `@nitpickr review`
7. Check both Railway logs:
   - API should accept and queue the webhook
   - worker should claim the job and publish the review

## Operational notes

- `/healthz` is the safe deployment healthcheck for the API service.
- `/readyz` is stricter and should be used for uptime checks because it verifies:
  - database connectivity
  - runtime setup status
  - recent worker heartbeat
- only the API service needs public networking
- the worker can scale independently from the API if you need more review
  throughput later
