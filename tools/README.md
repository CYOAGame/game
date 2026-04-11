# tools/

Out-of-band tooling for the Journal RPG game.

## OAuth Worker (`oauth-worker.js`)

A minimal Cloudflare Worker that exchanges a GitHub OAuth `code` for an access
token. The client secret lives only in the worker's Cloudflare environment —
never in the SvelteKit bundle.

### 1. Register the GitHub OAuth App

1. Go to `https://github.com/organizations/CYOAGame/settings/applications/new`
   (or your equivalent org settings).
2. **Application name:** `CYOAGame Journal RPG`
3. **Homepage URL:** `https://cyoagame.github.io/game/`
4. **Authorization callback URL:** *(set this after step 2 below — leave as
   a placeholder for now, e.g. `https://example.invalid/callback`)*
5. Submit. Note the **Client ID** shown on the next page.
6. Click **Generate a new client secret** and save the secret somewhere safe.
   You'll paste it into Cloudflare in step 2.

### 2. Deploy the Cloudflare Worker

Install Wrangler if you don't have it:

```bash
npm install -g wrangler
```

Log in:

```bash
wrangler login
```

From the repo root, set the required secrets (paste each when prompted):

```bash
cd tools
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put APP_URL
```

For `APP_URL`, paste `https://cyoagame.github.io/game` (no trailing slash).

Deploy:

```bash
wrangler deploy
```

Wrangler prints the worker URL — something like
`https://cyoagame-oauth-worker.your-subdomain.workers.dev`.

### 3. Finish wiring up GitHub

Go back to your OAuth App settings and set the **Authorization callback URL**
to `<worker-url>/callback` — e.g.
`https://cyoagame-oauth-worker.your-subdomain.workers.dev/callback`.

### 4. Configure the SvelteKit app

Copy `.env.example` to `.env` and fill in:

```
PUBLIC_GITHUB_CLIENT_ID=<the client id from step 1>
PUBLIC_OAUTH_WORKER_URL=<the worker url from step 2>
```

Commit `.env.example` but NOT `.env`. `.env` is already covered by
`.gitignore`.

### 5. Local testing

For local dev (`npm run dev`), use a separate OAuth App with callback
`http://localhost:5173/login` pointed at a local worker (`wrangler dev`).
Production and dev OAuth Apps can coexist — just swap the env vars.

## Troubleshooting

- **"Bad verification code"** — the code has already been exchanged or
  expired. Restart the login flow.
- **Consent screen loops back to an error page** — check that the
  `APP_URL` secret matches the domain in the homepage URL of the OAuth App
  exactly (including http/https and path prefix).
- **`state` mismatch on return** — the browser lost sessionStorage between
  the redirect out and the redirect back (common with strict tracking-prevention
  settings). Tell the user to open the site in a normal tab and retry.
