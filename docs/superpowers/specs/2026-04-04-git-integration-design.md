# Git Integration — Design Spec

**Date:** 2026-04-04
**Status:** Draft — pending review

## Vision

Replace localStorage with GitHub as the world's source of truth. Players authenticate with GitHub, fork a template repo to create worlds, load YAML blocks from the repo, and push state changes back on save. The game becomes a GitHub-native application where every world is a repo.

## Scope

This spec covers: authentication (OAuth + PAT), reading world data from a GitHub repo, writing state back, the template repo structure, and the "Create World" / "Join World" flows. 

**Not in scope:** PR lifecycle for journal entries, multiplayer conflict resolution, full offline clone mode. These build on this foundation and get their own specs.

## 1. Authentication

### Two Auth Paths

**GitHub OAuth:**
- "Login with GitHub" button on the login page
- Standard OAuth flow: redirect to GitHub → user authorizes → callback with code → exchange for token
- The token exchange requires a server-side component (GitHub won't send tokens to a browser). A minimal Cloudflare Worker handles this (~20 lines of code). We provide the worker code; deploying it is a manual admin step.
- Scopes requested: `repo` (read/write to repos), `read:user` (get username)

**Personal Access Token (PAT):**
- Player generates a fine-grained PAT in GitHub settings with `Contents: Read and write` and `Metadata: Read` permissions on the target repo
- Player pastes the token into the game
- No server-side component needed
- Good for development, testing, and privacy-conscious players

### Token Storage

- Token stored in localStorage under a dedicated key (`journal-rpg-github-token`)
- Never included in world state, never committed to any repo
- The game's `PlayerPrefs` gains: `githubToken?: string`, `repoOwner?: string`, `repoName?: string`, `repoUrl?: string`

### Auth Validation

On login, the game:
1. Calls `GET /user` to verify the token works and get the username
2. Stores the username for display and commit attribution
3. If the token is invalid/expired, shows an error and clears it

## 2. Reading from the Repo (YAML Loading)

### Load Flow

When connecting to a repo, the game fetches via Octokit:

1. `GET /repos/{owner}/{repo}/contents/world.yaml` → parse as `WorldConfig`
2. `GET /repos/{owner}/{repo}/contents/blocks/archetypes` → list files → fetch each → parse as `Archetype[]`
3. `GET /repos/{owner}/{repo}/contents/blocks/events` → list files → fetch each → parse as `EventTemplate[]`
4. `GET /repos/{owner}/{repo}/contents/blocks/locations` → list files → fetch each → parse as `LocationType[]`
5. `GET /repos/{owner}/{repo}/contents/blocks/questlines` → list files → fetch each → parse as `Questline[]`
6. `GET /repos/{owner}/{repo}/contents/state/characters` → list files → fetch each → parse as `Character[]`
7. `GET /repos/{owner}/{repo}/contents/state/timeline.yaml` → parse as `TimelineEntry[]`
8. `GET /repos/{owner}/{repo}/contents/state/questline-state.yaml` → parse as `QuestlineProgress[]`
9. `GET /repos/{owner}/{repo}/contents/state/factions.yaml` → parse as `FactionState[]`
10. `GET /repos/{owner}/{repo}/contents/state/world-facts.yaml` → parse as `Record<string, ...>`

All state files may not exist initially (fresh world). The loader handles missing files gracefully — empty arrays/objects as defaults.

### Caching

After fetching, the game caches:
- The parsed `WorldBlocks` and `WorldState` in localStorage
- The SHA of each file (returned by GitHub API)

On subsequent loads:
- Use the cached SHA to check if files changed (`If-None-Match` or compare SHAs via the tree API)
- If unchanged, use cache — no re-download
- If changed, re-fetch the changed files only

### Offline Fallback

If the GitHub API is unreachable:
- Use the cached version from localStorage
- Show an "offline mode" indicator
- Disable write operations (saves queue locally)

### Repo Validation

When connecting to a repo, validate:
- `world.yaml` exists at the root
- It parses as a valid `WorldConfig` (has `name`, `setting`, `dateSystem`)
- If invalid, show a clear error: "This doesn't look like a Journal RPG world repo"

## 3. Writing Back to the Repo

### What Gets Written on Save

When a player saves a journal entry:

| File | Content |
|---|---|
| `state/characters/{id}.yaml` | Each character that changed during the session |
| `state/timeline.yaml` | Full timeline with new entry appended |
| `state/questline-state.yaml` | Updated questline progress |
| `state/factions.yaml` | Updated faction moods |
| `state/world-facts.yaml` | Updated world facts |
| `state/recent-events.yaml` | Updated staleness tracker |
| `journals/{character}/{date}.md` | Human-readable journal entry |
| `players/{github-username}.yaml` | Player prefs (played characters, etc.) |

### Write Strategy

**Primary: immediate commit via GitHub API**

Each file is written via `PUT /repos/{owner}/{repo}/contents/{path}` with:
- `content`: base64-encoded file content
- `sha`: the SHA of the file being replaced (for conflict detection)
- `message`: descriptive commit message (e.g., "Elena the blacksmith — Spring, Day 14")

Multiple files = multiple API calls (sequential). The GitHub Contents API doesn't support atomic multi-file commits. For atomicity, we'd need the Git Data API (create tree → create commit → update ref), which is more complex but ensures all files land in one commit.

**Approach:** Use the Git Data API for atomic multi-file commits:
1. `GET /repos/{owner}/{repo}/git/ref/heads/main` → get current commit SHA
2. `GET /repos/{owner}/{repo}/git/commits/{sha}` → get tree SHA
3. `POST /repos/{owner}/{repo}/git/trees` → create new tree with all changed files
4. `POST /repos/{owner}/{repo}/git/commits` → create commit pointing to new tree
5. `PATCH /repos/{owner}/{repo}/git/ref/heads/main` → update main to new commit

This gives us atomic multi-file commits — all changes from a session land in one commit or none.

**Fallback: localStorage queue**

If writes fail (network error, 409 conflict):
- Queue the pending changes in localStorage
- Show a "pending sync" indicator in the UI
- On next session start or manual "Sync" button click, retry
- If a conflict is detected (SHA mismatch), fetch the latest state, merge locally, retry

### Conflict Detection

The GitHub API returns 409 if the SHA doesn't match (someone else pushed). For now, last-write-wins with a warning. Proper merge conflict resolution is deferred to the multiplayer spec.

### Journal Entry Formatting

Each saved session writes a markdown file to `journals/{character}/{date}.md`:

```markdown
# Elena the Blacksmith — Spring, Day 14, Year 847

The market was busy today. A stranger stumbled through the gate, dusty and limping...

> Offered them water and a seat

The stranger drank deeply and caught their breath...

> Took them to the town guard for protection

---
**Consequences:** Cunning +1, Town Guard reputation increased, World fact: traveler_reported
```

This is narrative output — not game state. It's readable directly on GitHub.

## 4. Template Repo

### Structure

A GitHub template repo (marked as template in GitHub settings) with the Ironhaven demo world:

```
journal-rpg-ironhaven/
├── world.yaml
├── theme/
│   └── style.css
├── blocks/
│   ├── archetypes/
│   │   ├── blacksmith.yaml
│   │   ├── merchant.yaml
│   │   └── soldier.yaml
│   ├── events/
│   │   ├── market-day.yaml
│   │   ├── traveler-arrives.yaml
│   │   ├── satchels-secret.yaml
│   │   ├── guards-questions.yaml
│   │   ├── strangers-asking.yaml
│   │   ├── quiet-morning.yaml
│   │   ├── strange-rumors.yaml
│   │   ├── well-runs-dry.yaml
│   │   ├── night-watch.yaml
│   │   └── festival-approaches.yaml
│   ├── locations/
│   │   ├── tavern.yaml
│   │   └── market-quarter.yaml
│   └── questlines/
│       └── demon-invasion.yaml
├── state/
│   ├── characters/
│   ├── timeline.yaml
│   ├── questline-state.yaml
│   ├── factions.yaml
│   └── world-facts.yaml
├── journals/
└── players/
```

The `state/` directory starts with empty/default files. As players play, state files are populated via commits.

### "Create World" Flow

1. Player is authenticated
2. Player clicks "Create World"
3. Game calls GitHub API to fork the template repo into the player's account: `POST /repos/{template-owner}/{template-repo}/forks`
4. Player can optionally rename the fork
5. Game connects to the new fork
6. Player is ready to play

### "Join World" Flow

1. Player is authenticated
2. Player enters a repo URL or picks from a list of repos they have access to
3. Game validates the repo structure (checks for `world.yaml`)
4. Game connects and loads
5. Player must have write access (collaborator) to save. If read-only, the game works but saves only to localStorage with a warning.

### "Play Offline Demo" Fallback

For players who don't want a GitHub account:
- Keep the hardcoded demo world in `getDemoWorldBlocks()` as a fallback
- "Play Offline" button on the landing page bypasses auth and uses localStorage only
- These players can't sync to GitHub but can still play the full game locally

## 5. UI Changes

### New Pages

**`/login`** — Authentication page
- "Login with GitHub" button (OAuth) — prominent
- "Use Personal Access Token" section — expandable, with token input and "Connect" button
- "Play Offline" link — skips auth entirely
- Clean dark aesthetic matching existing pages

**`/connect`** — Repo selection (shown after auth)
- "Create World" button — forks template repo
- "Join World" — text input for repo URL + "Connect" button
- "Recent Worlds" — list of previously connected repos (from localStorage)
- "Continue" — reconnects to last used repo

### Modified Pages

**Landing page (`/`)** — becomes auth-aware:
- If not authenticated: shows login/offline options
- If authenticated but no repo: redirects to `/connect`
- If authenticated and connected: shows existing "Continue World" / "Settings" / "World Inspector" UI

**Session-end page** — save handler gains GitHub write:
- On save: write to GitHub (primary), fall back to localStorage if it fails
- Show sync status indicator (synced/pending/error)

**Settings page** — add GitHub section:
- Connected repo display (owner/name)
- "Disconnect" button
- "Sync Now" button (for manual retry of pending changes)
- GitHub username display

## 6. New Files

- `src/lib/git/github-client.ts` — Octokit wrapper: auth validation, user info, repo operations
- `src/lib/git/yaml-loader.ts` — fetch and parse YAML files from GitHub repo into WorldBlocks/WorldState
- `src/lib/git/repo-writer.ts` — atomic multi-file commits via Git Data API, pending change queue
- `src/lib/git/journal-formatter.ts` — format PlaySession into markdown journal entry
- `src/lib/stores/github.ts` — auth state, connected repo info, sync status
- `src/routes/login/+page.svelte` — authentication page
- `src/routes/connect/+page.svelte` — repo selection page

## 7. Modified Files

- `src/routes/+page.svelte` — auth-aware landing page
- `src/routes/session-end/+page.svelte` — GitHub write on save
- `src/routes/settings/+page.svelte` — GitHub connection section
- `src/lib/stores/player.ts` — add GitHub-related prefs fields
- `src/lib/engine/world-loader.ts` — add GitHub-backed load/save mode
- `package.json` — add `octokit` dependency

## 8. OAuth Cloudflare Worker

Provided as a separate file (`tools/oauth-worker.js`) but NOT deployed as part of this spec. Admin deploys manually.

```js
// Minimal OAuth token exchange worker
// Deploy to Cloudflare Workers, set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET as secrets
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code
        })
      });
      const data = await response.json();
      // Redirect back to the app with the token
      return Response.redirect(`${env.APP_URL}/login?token=${data.access_token}`);
    }
    return new Response('Not found', { status: 404 });
  }
};
```

The game's OAuth flow:
1. Redirect to `https://github.com/login/oauth/authorize?client_id=...&redirect_uri=WORKER_URL/callback&scope=repo,read:user`
2. GitHub redirects to worker with code
3. Worker exchanges code for token
4. Worker redirects back to game with token in URL
5. Game stores token in localStorage

## Open Questions

None — all major design decisions resolved during brainstorming.
