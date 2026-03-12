# GitHub App setup

`nitpickr` currently supports GitHub through a GitHub App only. There is no
personal access token mode.

This guide walks through creating the app, mapping the GitHub values to
environment variables, and installing the app on repositories you want
reviewed.

Official GitHub references:

- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
- [Generating a private key for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-private-key-for-a-github-app)
- [Installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)

## 1. Create the app

In GitHub:

1. Open **Settings**.
2. Go to **Developer settings**.
3. Open **GitHub Apps**.
4. Click **New GitHub App**.

Recommended values:

- **GitHub App name**
  - pick the mention name you want people to use, for example `nitpickr-dev`
- **Homepage URL**
  - your repository URL is fine for local use
  - for a hosted deployment, your project or docs URL is also fine
- **Webhook**
  - enabled
- **Webhook URL**
  - `https://YOUR_PUBLIC_HOST/webhooks/github`
- **Webhook secret**
  - a random string you generate and also store in `GITHUB_WEBHOOK_SECRET`

Local note:

- if you run `nitpickr` locally, `YOUR_PUBLIC_HOST` must be a public HTTPS
  tunnel to `http://localhost:3000`

## 2. Set permissions

`nitpickr` needs these repository permissions:

- Pull requests: Read and write
- Contents: Read-only
- Issues: Read and write
- Checks: Read and write
- Metadata: Read-only

## 3. Subscribe to events

Enable these webhook events:

- Pull request
- Issue comment

That is enough for the current review and comment-command flow.

## 4. Create and save the private key

After the app is created:

1. Open the app settings page.
2. Copy the **App ID** into `GITHUB_APP_ID`.
3. In **Private keys**, click **Generate a private key**.
4. Download the `.pem` file.
5. Put the PEM contents into `GITHUB_PRIVATE_KEY`.

Prefer storing the PEM in your secret manager and referencing it as a protected
secret. Do not commit the private key.

If you must use an environment variable:

- use the escaped single-line form with `\n` for newlines, or a protected
  multiline secret if your deploy platform supports it
- restrict access to the secret to the smallest set of people and services that
  need it
- ensure logs, screenshots, debug dumps, and support output never include the
  raw `GITHUB_PRIVATE_KEY` value

`nitpickr` normalizes the escaped form at runtime.

If you need to materialize the key as a PEM file for local testing or another
tool, write it to disk with restrictive permissions:

```bash
printf '%b' "$GITHUB_PRIVATE_KEY" > github-app.private-key.pem
chmod 600 github-app.private-key.pem
```

Delete the file when you are done with it and never commit it to the repository.

## 5. Install the app on repositories

From the GitHub App page:

1. Click **Install App**.
2. Choose the account or organization.
3. Install it on:
   - all repositories, or
   - only the repositories you want `nitpickr` to review

If you later change permissions, GitHub may ask you to approve the updated
permissions again.

## 6. Map GitHub values to environment variables

| Variable | Value |
| --- | --- |
| `GITHUB_APP_ID` | The numeric App ID from the GitHub App settings page |
| `GITHUB_PRIVATE_KEY` | The PEM file content from **Generate a private key** |
| `GITHUB_WEBHOOK_SECRET` | The same secret you configured in the GitHub App |
| `NITPICKR_BASE_URL` | The public HTTPS base URL for your nitpickr API |
| `NITPICKR_WEBHOOK_URL` | `https://YOUR_PUBLIC_HOST/webhooks/github` |
| `GITHUB_BOT_LOGINS` | The mention handle(s) nitpickr should respond to, usually your app name without `@` |

`GITHUB_BOT_LOGINS` is comma-separated. Example:

```env
GITHUB_BOT_LOGINS=nitpickr-dev,nitpickr
```

## 7. Verify the setup

Before opening a PR:

1. Run `pnpm cli doctor` with your environment exported.
2. Confirm the GitHub App webhook URL ends with `/webhooks/github`.
3. Confirm the app is installed on the target repository.
4. Confirm the repository can mention the configured bot login.

Then open a PR and try:

```text
@nitpickr review
```

## Troubleshooting

### GitHub says the webhook failed

- Check that the public URL is reachable from GitHub.
- Confirm the webhook secret matches `GITHUB_WEBHOOK_SECRET`.
- Confirm the route ends in `/webhooks/github`.

### The PR comment mention is ignored

- Confirm the app is installed on that repository.
- Confirm the mention matches one of the values in `GITHUB_BOT_LOGINS`.
- Confirm the command is in a PR conversation or in reply to a nitpickr comment,
  depending on the command.

### The app cannot post checks or comments

- Re-check the permissions list above.
- If you changed permissions after installation, reinstall or approve the new
  permissions in GitHub.
