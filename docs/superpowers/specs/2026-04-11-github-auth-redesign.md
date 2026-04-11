# GitHub Auth Redesign

**Date:** 2026-04-11
**Status:** Design approved, ready for implementation planning

## Problem

The current login flow (`src/routes/login/+page.svelte`) asks users to paste a
classic GitHub Personal Access Token with `repo` scope. That scope grants
read/write access to **every repository the user owns or collaborates on**, and
several prospective players have pushed back on handing over that level of
access to the game.

We want a login experience with two clearly-communicated paths:

1. A friction-free OAuth path for casual users who just want to play.
2. A security-conscious path using fine-grained Personal Access Tokens that
   grants access to exactly one repo and nothing else.

## Goals

- Wire up the currently-disabled "Login with GitHub" button by deploying a
  Cloudflare Worker that handles the OAuth token exchange, backed by a GitHub
  OAuth App registered under the `CYOAGame` organization.
- Add a multi-step "manual fork wizard" that walks security-conscious users
  through forking the template (or joining an existing shared world) and
  creating a fine-grained PAT scoped to that single repo.
- Preserve the existing multiplayer save flow (`saveWithPR` in
  `src/lib/git/repo-writer.ts`) for both auth methods.
- Clean up the split-brain token storage where `playerPrefs.githubToken` and
  `githubState` both track auth independently.
- Handle token expiry gracefully: any 401 from GitHub clears the session and
  routes the user back to `/login` with an explanatory banner.

## Non-goals (out of scope for this spec)

- **Private-world auto-join.** Adding players to private repos automatically
  requires either owner-in-the-loop invites or a GitHub App with
  collaborator-management permissions. Owner-approved invites are planned as
  a follow-up feature; see "Future work" below.
- **GitHub App foundation.** A per-repo-installable GitHub App would give
  better fine-grained scoping than OAuth's account-wide `repo` scope, but is
  significantly larger in scope and is deferred.
- **Refactoring `repo-writer.ts`.** The branch/PR/merge flow stays as-is; we
  only wrap its Octokit calls with the new expiry-handling helper.

## Scope

This spec covers end-to-end auth: the OAuth deployment artifact, the PAT
wizard routes, the store/state cleanup, and expiry handling. It does **not**
cover any changes to world content, gameplay, or the journal save flow beyond
wrapping existing Octokit calls for expiry handling.

## Architecture overview

### Two parallel auth paths

```
┌────────────────────┐       ┌────────────────────────────┐
│   /login           │       │   /login/pat-wizard        │
│                    │       │                            │
│ [Login with GitHub]│       │  choose variant            │
│        │           │       │    ├─ Create new world     │
│        ▼           │       │    │    step 1: fork       │
│  github.com/       │       │    │    step 2: create PAT │
│  oauth/authorize   │       │    └─ Join existing world  │
│        │           │       │         step 1: confirm    │
│        ▼           │       │         step 2: create PAT │
│  Cloudflare Worker │       │                            │
│  /callback         │       │  validate → store → /connect│
│  (exchanges code)  │       └────────────────────────────┘
│        │                              ▲
│        ▼                              │
│  /login?token=…&method=oauth ─────────┘
│        │
│        ▼
│   validateToken → store → /connect
└────────────────────┘
```

Both paths converge on writing `{ token, authMethod, username }` into
`githubState`, after which `/connect` and the rest of the app behave
identically.

### Flow: Create World divergence at `/connect`

| Path          | OAuth user                          | PAT user                                |
|---------------|-------------------------------------|-----------------------------------------|
| Create World  | `forkRepo()` works in-app           | Hidden; message directs back to wizard  |
| Join World    | Works                               | Works (PAT must be scoped to that repo) |
| Recent World  | Works                               | Works                                   |

PAT users effectively perform "Create World" *during* login, because a
fine-grained PAT scoped to a single repo cannot fork another repo. This is
honest to the permission model: the auth step and the create step are fused
for the PAT path.

### Fine-grained PAT permission requirements

The wizard's instructions must tell users to grant the following permissions
when creating the token:

- **Contents: Read and write** — for commits, branches, blobs, trees, merges
- **Metadata: Read** — required for almost every API call (GitHub default)
- **Pull requests: Read and write** — required by `saveWithPR` to open and
  merge character-branch PRs

A token missing "Pull requests: R/W" will commit to branches but fail to
open/merge PRs. The wizard cannot *prove* all three permissions are present
up front — GitHub's `repos.get().permissions` field reflects the user's
collaborator role, not the fine-grained PAT's granted permissions. Step 2
therefore validates only what is cheaply verifiable: `validateToken` (token
is valid, user identified) and `validateRepo` (token can read the repo, user
has push role). Missing Contents or Pull requests permissions surface on
first save as a clear 403 from `saveWithPR`, at which point the user can
update the PAT on github.com and retry. The wizard copy warns about this
explicitly so a save failure is not a surprise.

## Components

### New files

#### `src/routes/login/pat-wizard/+page.svelte`

A multi-step wizard implemented as a single route with reactive `step` state:

```
step = 'choose' | 'create-step1' | 'create-step2'
              | 'join-step1'   | 'join-step2'
```

- **`choose`** — two large buttons: "Create a new world" / "Join an existing
  world". Sets variant and advances.
- **`create-step1`** — "Open `CYOAGame/ironhaven` on GitHub and click Fork."
  Opens github.com in a new tab. User returns and pastes their fork URL (or
  `owner/repo`). On advance, stores the parsed repo in sessionStorage.
- **`create-step2`** — "Create a fine-grained PAT for your fork." Link opens
  `https://github.com/settings/personal-access-tokens/new` in a new tab with
  description pre-filled. Lists the three required permissions (Contents:
  R/W, Metadata: R, Pull requests: R/W) with copy-to-clipboard affordances,
  plus a warning that missing permissions will surface as a save error
  later, not at this step. User pastes the token. On advance, calls
  `validateToken` + `validateRepo` to confirm the token is valid and can
  access the repo, then writes to `githubState` and navigates to `/connect`.
- **`join-step1`** — "Enter the `owner/repo` of the world you want to join."
  Wizard asks the user to confirm they're already a collaborator (we can't
  verify without a token yet). Advances on valid-looking input.
- **`join-step2`** — Same as `create-step2`, with the repo already known.

State persists to `sessionStorage['journal-rpg-pat-wizard']` at every
transition so reloads resume mid-wizard. State is cleared on successful
completion or when the user explicitly cancels.

#### `tools/wrangler.toml`

Cloudflare Worker config for `oauth-worker.js`:

```toml
name = "cyoagame-oauth-worker"
main = "oauth-worker.js"
compatibility_date = "2026-04-11"

# Secrets set via `wrangler secret put`:
#   GITHUB_CLIENT_ID
#   GITHUB_CLIENT_SECRET
#   APP_URL
```

#### `tools/README.md`

Two sections:

1. **Registering the GitHub OAuth App** — step-by-step at
   `https://github.com/organizations/CYOAGame/settings/applications/new`,
   homepage URL `https://cyoagame.github.io/game/`, callback URL (set after
   worker deploy), scope `repo`, where to find client ID and generate client
   secret.
2. **Deploying the OAuth Worker** — `wrangler login`,
   `wrangler secret put GITHUB_CLIENT_ID`, etc., `wrangler deploy`, copy the
   `*.workers.dev` URL back into the GitHub App callback URL field and into
   the SvelteKit env as `PUBLIC_OAUTH_WORKER_URL`.

#### `tests/routes/pat-wizard.test.ts`

Unit tests for the wizard state machine:

- Each step transition validates input before advancing.
- sessionStorage round-trip: serialize state, reload, resume at same step.
- Validation failures show inline errors without advancing.
- Successful completion writes `{ token, authMethod: 'pat', username }` to
  `githubState`.
- Cancel wipes sessionStorage.

### Modified files

#### `src/lib/stores/github.ts`

- Add `authMethod: 'oauth' | 'pat' | null` to `GitHubState`.
- **Stop stripping the token** in `saveGitHubState` (currently at line 43).
  Persist the full state including the token.
- Add `clearAuth()`: wipes `token`, `authMethod`, `username`,
  `isAuthenticated`, and `isConnected` from both the store and localStorage.
- Add `AuthExpiredError` class and a `handleAuthError(err)` helper that
  detects 401s, calls `clearAuth()`, and throws `AuthExpiredError`.

#### `src/lib/stores/player.ts`

- **Remove** `githubToken` and `githubUsername` from `PlayerPrefs`. The store
  keeps `dayTypePreferences`, `llmSetting`, `llmEndpoint`, `llmModel`,
  `llmApiKey`, `repoOwner`, `repoName`.
- One-time migration in `loadPlayerPrefs`: if loaded prefs contain a
  `githubToken`, copy it into `githubState` + localStorage (with
  `authMethod: null`, which causes the next 401 to trigger the reconnect
  banner), then strip it from prefs and re-save.

#### `src/routes/login/+page.svelte`

- Wire up the `.btn-oauth` button. On click:
  1. Generate random `state`, store in `sessionStorage['oauth-state']`.
  2. Redirect to
     `https://github.com/login/oauth/authorize?client_id=${PUBLIC_GITHUB_CLIENT_ID}&scope=repo&redirect_uri=${PUBLIC_OAUTH_WORKER_URL}/callback&state=${state}`.
- On mount, if `?token=…&method=oauth&state=…` present:
  1. Verify `state` matches sessionStorage. Mismatch → error banner.
  2. Call `handleConnect(token, 'oauth')`.
- Replace the PAT input section with a single "Use a Personal Access Token"
  button that navigates to `/login/pat-wizard`.
- Render an error banner at the top when `?error=expired` is present.
- `handleConnect` gains an `authMethod` parameter and records it in the
  store.

#### `src/routes/connect/+page.svelte`

- In `handleCreateWorld`, check `$githubState.authMethod`:
  - `'oauth'` → unchanged behavior (calls `forkRepo()`).
  - `'pat'` → show message "Create World requires Login with GitHub. [Logout
    and switch]" instead of invoking the fork.
- `handleLogout` calls `clearAuth()` from the store rather than hand-editing
  `playerPrefs` and `githubState` separately.

#### `src/lib/git/github-client.ts`

- Add a thin wrapper `async function handleRequest<T>(fn: () => Promise<T>): Promise<T>`
  that catches errors, checks for `status === 401` (both shapes Octokit
  throws), calls `clearAuth()`, and throws `AuthExpiredError`.
- Wrap runtime-path API calls: `forkRepo`, `listUserRepos`,
  `checkForkStatus`, `syncFork`. These are called from `/connect` and later
  pages where a 401 genuinely means the session expired.
- **Exempt login-time validators from `handleRequest`:** `validateToken` and
  `validateRepo` are both used by the PAT wizard to test candidate tokens
  before any session exists. A 401 on either of them means "the token the
  user just pasted is bad," not "session expired." They should continue to
  return `{ valid: false }` / `{ valid: false, error: … }` as they do today,
  without touching `githubState`. This preserves correctness when the user is
  validating a new PAT while already holding an older valid session.

#### `src/lib/git/repo-writer.ts`

- Wrap the Octokit calls in `commitFiles`, `ensureBranch`, `commitToBranch`,
  `ensurePR`, `syncBranchWithMain`, `mergeBranchToMain` with `handleRequest`.
- `saveWithPR` propagates `AuthExpiredError` up to the caller. The existing
  409 merge-conflict retry logic is unchanged.

#### `tools/oauth-worker.js`

- Accept a `state` query param on the authorize redirect, round-trip it
  through the callback unchanged so the client can verify.
- Add `&method=oauth` to the redirect URL at line 30.

#### `.env.example` (new)

```
PUBLIC_GITHUB_CLIENT_ID=your_oauth_app_client_id
PUBLIC_OAUTH_WORKER_URL=https://cyoagame-oauth-worker.your-subdomain.workers.dev
```

Both are `PUBLIC_*` because SvelteKit needs them in the browser bundle. The
`client_secret` **never** appears in this file — it lives only in Cloudflare
Worker secrets.

## Data flow walkthroughs

### OAuth happy path

1. User clicks "Login with GitHub" on `/login`.
2. Login page generates random `state`, stores in sessionStorage, redirects
   to `github.com/login/oauth/authorize?…&state=…`.
3. User authorizes on GitHub.
4. GitHub redirects to the Cloudflare Worker `/callback?code=…&state=…`.
5. Worker POSTs to `github.com/login/oauth/access_token` with client
   credentials and the code, receives an access token.
6. Worker redirects to
   `${APP_URL}/login?token=${access_token}&method=oauth&state=${state}`.
7. Login page verifies `state` matches sessionStorage, calls
   `validateToken(token)`, writes `{ token, authMethod: 'oauth', username }`
   to `githubState`, redirects to `/connect`.

### PAT create-variant happy path

1. User clicks "Use a Personal Access Token" → navigates to
   `/login/pat-wizard`.
2. Selects "Create a new world."
3. Step 1: clicks "Fork CYOAGame/ironhaven" (opens github.com in new tab),
   manually forks, returns, pastes fork URL. Wizard parses, stores in
   sessionStorage, advances.
4. Step 2: clicks "Create PAT" (opens github.com in new tab with description
   pre-filled), follows the listed permissions, creates the token, returns,
   pastes. Wizard calls `validateToken` + `validateRepo` to verify both the
   token and the permissions work. On success, writes `{ token, authMethod:
   'pat', username }` to `githubState`, clears wizard sessionStorage, navigates
   to `/connect`.

### PAT join-variant happy path

Same as create-variant, except:
- Step 1 asks for an existing `owner/repo` and confirmation that the user is
  already a collaborator. No github.com round-trip.
- Step 2 instructs creating a PAT for that specific repo.

### Token expiry mid-session

1. User triggers a save → `saveWithPR` → Octokit call returns 401.
2. `handleRequest` wrapper sees 401, calls `clearAuth()` (wipes token,
   authMethod, localStorage), throws `AuthExpiredError`.
3. Caller (journal page, or wherever save was triggered) catches
   `AuthExpiredError` → `goto('/login?error=expired')`.
4. Login page renders banner: "Your token expired — please reconnect." Since
   `authMethod` is cleared, both the OAuth button and the PAT wizard link are
   shown. User picks one, reconnects, lands on `/connect`.

## Error handling

| Scenario | Detection | Response |
|---|---|---|
| OAuth `state` mismatch | `/login` onMount | Error banner, do not store token |
| OAuth worker reports error | `?error=…` query param | Error banner on `/login` |
| PAT fails `validateToken` | wizard step 2 advance | Inline error, stay on step |
| PAT fails `validateRepo` | wizard step 2 advance | Inline error "Token works but can't access that repo — check permissions and repo scope" |
| 401 during runtime API call | `handleRequest` wrapper | `clearAuth()` → `AuthExpiredError` → `/login?error=expired` |
| 401 during `validateToken` / `validateRepo` | These functions are exempt from `handleRequest` | Return `{ valid: false, … }` — this is expected at login time, not an expiry. `githubState` is not touched. |
| 403 forbidden | `handleRequest` passes through | Normal error path, not auth-related |
| 409 on PR merge | existing retry logic in `repo-writer.ts` | Unchanged |
| Network failure | try/catch in callers | Existing behavior |
| Legacy token in `playerPrefs` | migration in `loadPlayerPrefs` | Copy to `githubState` with `authMethod: null`, strip from prefs |

## Testing plan

### Unit tests

- **`tests/git/github-client.test.ts`** (extend existing)
  - `handleRequest` with a 401 → calls `clearAuth`, throws `AuthExpiredError`.
  - `handleRequest` with 403/404 → passes through without clearing.
  - `validateToken` with a 401 → returns `{ valid: false }`, does **not**
    clear, does **not** throw `AuthExpiredError`.
  - `validateRepo` with a 401 → returns `{ valid: false, error: … }`, does
    **not** clear, does **not** throw `AuthExpiredError`.
  - `validateRepo` / `validateToken` called while `githubState` already has
    a valid session → an invalid candidate token does not wipe the existing
    session.

- **`tests/routes/pat-wizard.test.ts`** (new)
  - Each step transition: valid input advances, invalid input blocks.
  - sessionStorage round-trip: serialize at each step, reload, resume
    correctly.
  - Completion writes to `githubState` and clears wizard sessionStorage.
  - Cancel clears sessionStorage without writing to `githubState`.

- **`tests/stores/github.test.ts`** (new)
  - `saveGitHubState` persists the full state including token (regression
    test for the current stripping bug).
  - `clearAuth` wipes all auth fields in store and localStorage.
  - `loadGitHubState` round-trips full state.

- **`tests/stores/player.test.ts`** (new)
  - Legacy migration: prefs with `githubToken` → token copied to
    `githubState`, prefs rewritten without token.
  - Fresh install: no migration, no errors.

### Manual test checklist

- [ ] OAuth happy path end-to-end: login → connect → create world → save
      journal entry.
- [ ] PAT create-variant end-to-end: wizard → fork on github.com → PAT on
      github.com → paste → connect → save journal entry.
- [ ] PAT join-variant end-to-end: wizard → confirm collaborator → PAT → paste
      → connect → save journal entry.
- [ ] Token expiry mid-save: revoke token in GitHub settings, trigger save,
      verify redirect to `/login?error=expired` with correct banner.
- [ ] Logout from `/connect` clears all state and returns to `/login`.
- [ ] Reload mid-wizard: state restored at correct step.
- [ ] OAuth `state` mismatch rejects login (manually tamper with query
      param).
- [ ] Legacy token migration: put a `githubToken` in old `playerPrefs` shape
      in localStorage, load app, verify migration and continued access.

### Not automated

- Cloudflare Worker deploy itself. Verified manually once during rollout.
- GitHub OAuth App registration. One-time setup documented in
  `tools/README.md`.

## Architectural notes

- **Why `PUBLIC_*` env vars for `client_id`:** GitHub OAuth `client_id` is not
  secret — it appears in the authorize URL every user sees. Only the
  `client_secret` is confidential, and it lives exclusively in Cloudflare
  Worker secrets.
- **Why sessionStorage for wizard state:** localStorage would leak across
  tabs and persist after logout; sessionStorage is per-tab and dies with the
  tab, which exactly matches the "mid-wizard resumption" scope.
- **Why wrap every API call with `handleRequest` rather than Octokit hooks:**
  Octokit's hook API would work, but scatters 401 handling across setup
  code. A call-site wrapper keeps the expiry policy in one grep-able place.
- **Why the PAT join-variant can't verify collaborator status before step 2:**
  The user has no token yet. We accept the risk that a user might paste a PAT
  scoped to a repo they don't actually have push access to — `validateRepo`
  at step 2 will catch this case (it checks `permissions?.push`).
- **Why Create World is unavailable on the PAT path:** A fine-grained PAT
  scoped to a single repo cannot fork a *different* repo. We cannot make this
  work without broadening the PAT's scope, which defeats the purpose. The
  honest answer — "Create World needs the OAuth path" — is clearer than any
  workaround.
- **Why we migrate `playerPrefs.githubToken` instead of simply deleting it:**
  Existing players already have tokens stored in the old location.
  Deleting would force them to re-authenticate on upgrade, which is bad UX
  for something they didn't break. The migration preserves their session.

## Future work

Two features are explicitly out of scope for this spec but are worth
noting so future-us remembers the reasoning:

1. **Owner-approved public-world invites.** *Scoped and in progress — see
   [`2026-04-11-owner-approved-invites.md`](./2026-04-11-owner-approved-invites.md).*
   When a player wants to join a public shared world (e.g.
   `CYOAGame/Public_Game`), they open a pre-filled GitHub Issue on the repo;
   the world owner sees it as a Pending Invite card in their own game session
   and approves with one tap, which uses their token to call
   `POST /repos/{owner}/{repo}/collaborators/{username}`. Zero new
   infrastructure — reuses auth from this spec. Note: this is scoped to
   *public* worlds only; private-world auto-join still requires a GitHub App
   and remains future work.

2. **GitHub App foundation.** A per-repo-installable GitHub App (distinct
   from the OAuth App built here) would give narrower, short-lived installation
   tokens scoped to individual worlds. Worth building if private-world open
   communities become a real audience. The current design does not paint us
   into a corner for this addition: installation tokens are bearer tokens that
   flow through the same `githubState` and `handleRequest` plumbing, with
   `authMethod: 'app_installation'` as a third value.
