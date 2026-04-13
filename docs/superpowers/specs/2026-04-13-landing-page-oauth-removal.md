# Landing Page + OAuth Removal

**Date:** 2026-04-13
**Status:** Design approved, ready for implementation planning

## Problem

The game currently opens to a `/login` page that asks for GitHub credentials
before the player can do anything. This is wrong for two reasons:

1. Most players don't need GitHub at all — invited players arrive via an
   invite link that already contains the token, and offline players need
   nothing. Only world *hosts* (who fork the template and manage invites)
   need a GitHub PAT.
2. There's no page that explains what the game is. A stranger who discovers
   the URL sees "Connect to GitHub to save your world" — meaningless without
   context.

## Goals

- Replace the root route (`/`) with a landing page that explains what
  Journal RPG is, offers zero-friction entry points, and teaches hosts how
  to set up their own world.
- Remove GitHub OAuth entirely — the OAuth worker, the GitHub App
  registration, the env vars, and all related code. The only auth model is
  fine-grained PATs (for hosts) and invite codes (for players).
- Rename the PAT wizard from `/login/pat-wizard` to `/setup` to reflect
  that it's a host setup flow, not a login.
- Update expired-token redirects to branch on `authMethod`: hosts go to
  `/setup?error=expired`, invited players go to `/` with a "your invite
  expired" message.

## Auth model after this change

| User | Entry point | Auth mechanism | GitHub account needed? |
|---|---|---|---|
| Curious stranger | Landing page → Play Offline | None | No |
| Invited player | Invite link → `/invite?code=...` | Token embedded in the link | No |
| World host | Landing page → fork + PAT → `/setup` | Fine-grained PAT they create once | Yes |

There is no "login" concept. The `/login` route is deleted.

## Landing page structure (`/`)

Single scrollable page. Replaces the current `src/routes/+page.svelte`
which does an auth-check redirect.

### Section 1: Hero

- Title: "Journal RPG"
- Tagline: one line that captures the pitch (e.g., *"A choose-your-own-
  adventure game backed by git"* — Joe can wordsmith later)
- Uses the existing dark aesthetic (`--session-end-bg`, `--journal-accent`)

### Section 2: What is it

2-3 sentences:
- Interactive fiction where your choices shape a persistent world
- Progress saves as git commits
- Play solo offline or in a shared world with friends

### Section 3: Try it now

Two side-by-side CTAs:

1. **Play Offline** — links to `/?offline=true` (existing flow, works
   today, zero friction)
2. **Join the Public World** — links to a hardcoded invite URL:
   `{base}/invite?code=<PUBLIC_GAME_INVITE_CODE>`. The code is generated
   once by Joe from `/connect`'s "Generate Invite Link" button and pasted
   into the source as a constant. It contains Joe's PAT scoped to
   `Public_Game`, so it only needs to be regenerated if the PAT is rotated.

### Section 4: Host your own world

Step-by-step tutorial with external links that open in new tabs:

1. **Fork the template** — link to `https://github.com/CYOAGame/ironhaven`,
   click "Fork" on GitHub.
2. **Create a fine-grained PAT** — link to
   `https://github.com/settings/personal-access-tokens/new?description=Journal+RPG`.
   Lists required permissions:
   - Contents: Read and write
   - Metadata: Read (default)
   - Pull requests: Read and write
3. **Connect to the game** — link to `{base}/setup`. Paste the PAT, select
   the fork repo, connect.
4. **Invite friends** — from the Connect page, click "Generate Invite Link"
   and share it. Friends click the link, pick a name, and play — no GitHub
   account needed.

### Section 5: Footer

- "Already set up? Go to Setup" → `{base}/setup`
- "Play Offline" → `{base}/?offline=true`

### Error banner

When the URL has `?error=invite-expired`, show a banner at the top:
*"Your invite link has expired or was revoked. Ask the world owner for a
new one."*

This is the redirect target for invite-code users whose token expires
mid-session.

## OAuth removal

### Delete entirely

**OAuth artifacts:**

| Path | What it was |
|---|---|
| `tools/oauth-worker.js` | Cloudflare Worker for OAuth token exchange |
| `tools/wrangler.toml` | Worker deployment config |
| `tools/README.md` | OAuth App + Worker setup instructions |
| `.env.example` | Documented `PUBLIC_GITHUB_CLIENT_ID` + `PUBLIC_OAUTH_WORKER_URL` |
| `.env` | Local OAuth config (gitignored) |
| `src/routes/login/+page.svelte` | The login page (OAuth button + PAT link) |

**Join-request system (dead code — replaced by invite-code model):**

With invite links as the sharing mechanism, players never need to be
GitHub collaborators. The host's token (embedded in the invite link) is
what grants repo access. The entire join-request approval system is
therefore unnecessary.

| Path | What it was |
|---|---|
| `src/lib/invites/invite-client.ts` | `listJoinRequests`, `approveJoinRequest`, `denyJoinRequest` |
| `src/lib/invites/invite-url.ts` | `buildJoinRequestUrl` for pre-filled GitHub Issues |
| `src/lib/components/InvitesBadge.svelte` | Badge showing pending invite count during gameplay |
| `tests/invites/invite-client.test.ts` | Tests for the join-request orchestration |
| `tests/invites/invite-url.test.ts` | Tests for the issue URL builder |
| `docs/superpowers/specs/2026-04-11-owner-approved-invites.md` | The join-request feature spec |
| `docs/superpowers/plans/2026-04-11-owner-approved-invites.md` | The join-request implementation plan |

**Remove from files (join-request cleanup):**

- `src/lib/git/github-client.ts` — remove `addCollaborator` function
- `tests/git/github-client.test.ts` — remove `addCollaborator` tests
- `src/routes/connect/+page.svelte` — remove Pending Invites section,
  InvitesBadge import, "Not a collaborator yet" panel, "Invite a Player"
  form, `pollInvites`/`handleApprove`/`startDeny`/`confirmDeny`/
  `handleDirectInvite` functions and their state variables
- `src/routes/journal/+page.svelte` — remove `<InvitesBadge />` drop-in
- `src/routes/session-end/+page.svelte` — remove `<InvitesBadge />` drop-in
- `src/routes/timeline/+page.svelte` — remove `<InvitesBadge />` drop-in
- `src/routes/login/pat-wizard/+page.svelte` (becoming `/setup`) — remove
  the optional "Administration: Read and write" bullet from permissions list

### Rename

| From | To |
|---|---|
| `src/routes/login/pat-wizard/+page.svelte` | `src/routes/setup/+page.svelte` |
| `src/routes/login/pat-wizard/wizard-state.ts` | `src/routes/setup/wizard-state.ts` |
| `tests/routes/pat-wizard-state.test.ts` | `tests/routes/setup-wizard-state.test.ts` |

Update all imports and internal references after the rename.

### Modify

**`src/lib/stores/github.ts`**
- `AuthMethod` type: remove `'oauth'`. Becomes `'pat' | 'invite-code' | null`.

**`src/routes/connect/+page.svelte`**
- Remove the `authMethod === 'pat'` gate on Create World. PAT is now the
  only host auth method — the gate is always true. Keep the "Create World
  requires forking on GitHub" message since a scoped PAT still can't fork
  via the API, but remove the authMethod check.
- Remove any reference to OAuth in error messages or fallback copy.

**`src/routes/session-end/+page.svelte`**
- Change the `AuthExpiredError` redirect from `/login?error=expired` to
  a branch:
  ```typescript
  if ($githubState.authMethod === 'pat') {
      goto(`${base}/setup?error=expired`);
  } else {
      // invite-code user
      goto(`${base}/?error=invite-expired`);
  }
  ```

**All other files that redirect to `/login?error=expired`**
- Same branching pattern: `connect/+page.svelte` catch blocks,
  `routes/+page.svelte` (which is now the landing page and no longer does
  auth checks — the expired redirect lands here via the query param).

**`src/routes/setup/+page.svelte`** (the renamed wizard)
- Handle `?error=expired` query param: show a banner at the top of step 1
  saying *"Your PAT expired or was revoked. Please create a new one and
  reconnect."*
- Update all internal `{base}/login` references to `{base}/setup`.
- Update the "Back to login" footer link to "Back to home" → `{base}/`.

**`.github/workflows/deploy.yml`**
- Remove `PUBLIC_GITHUB_CLIENT_ID` and `PUBLIC_OAUTH_WORKER_URL` from the
  build `env:` block.

### Don't delete (Joe handles manually, out-of-band)

- The deployed Cloudflare Worker — `wrangler delete` when ready
- The GitHub OAuth App under CYOAGame org — delete from org settings
- The GitHub Actions secrets — delete from repo settings

## Testing

### Automated

- Existing tests should still pass after the rename (update import paths
  in `tests/routes/setup-wizard-state.test.ts`).
- No new unit tests needed — the landing page is static content, and the
  wizard logic is unchanged (just moved).

### Manual checklist

- [ ] Landing page renders at `/` with all 5 sections
- [ ] "Play Offline" link works (existing flow)
- [ ] "Join the Public World" link opens `/invite?code=...` with the
      hardcoded code, validates, shows the name-entry form
- [ ] "Host your own world" links all open correct github.com pages
- [ ] `/setup` renders the PAT wizard (same behavior as old `/login/pat-wizard`)
- [ ] `/login` returns 404 (deleted)
- [ ] Token expiry for a host mid-session → redirects to `/setup?error=expired`
      with the banner visible
- [ ] Token expiry for an invite-code player mid-session → redirects to
      `/?error=invite-expired` with the banner visible
- [ ] Full test suite passes
- [ ] `npm run check` shows no new errors

## Out of scope

- Fancy landing page animations or illustrations — plain styled content
  matching the existing dark journal aesthetic
- Blog/changelog section
- Custom domain setup
- Analytics
