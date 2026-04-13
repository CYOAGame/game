# Landing Page + OAuth Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auth-gated entry with a public landing page, remove GitHub OAuth entirely, delete the join-request approval system (replaced by invite links), and rename the PAT wizard from `/login/pat-wizard` to `/setup`.

**Architecture:** This is primarily a deletion + restructuring pass. The root route's `unauthenticated` branch expands from two buttons into a full landing page (game description, CTAs for offline/public-world, hosting tutorial). OAuth code is deleted. Join-request code is deleted. The PAT wizard moves to `/setup`. All `/login` redirects are updated to either `/setup` (hosts) or `/` (players). The public-world invite code is injected via `$env/static/public` from a GitHub Actions secret.

**Tech Stack:** SvelteKit 2, Svelte 5, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-13-landing-page-oauth-removal.md`

---

## File structure

### Files to delete

| Path | Reason |
|---|---|
| `src/routes/login/+page.svelte` | OAuth login page — no longer needed |
| `src/lib/invites/invite-client.ts` | Join-request orchestration — replaced by invite-code model |
| `src/lib/invites/invite-url.ts` | Pre-filled GitHub Issue URL builder — no longer needed |
| `src/lib/components/InvitesBadge.svelte` | Pending-invite badge — no longer needed |
| `tests/invites/invite-client.test.ts` | Tests for deleted module |
| `tests/invites/invite-url.test.ts` | Tests for deleted module |
| `tools/oauth-worker.js` | Cloudflare Worker source |
| `tools/wrangler.toml` | Worker config |
| `tools/README.md` | OAuth deployment instructions |
| `.env.example` | OAuth env var documentation |

### Files to rename

| From | To |
|---|---|
| `src/routes/login/pat-wizard/+page.svelte` | `src/routes/setup/+page.svelte` |
| `src/routes/login/pat-wizard/wizard-state.ts` | `src/routes/setup/wizard-state.ts` |
| `tests/routes/pat-wizard-state.test.ts` | `tests/routes/setup-wizard-state.test.ts` |

### Files to modify

| Path | Change |
|---|---|
| `src/routes/+page.svelte` | Expand `unauthenticated` branch into landing page; fix invite link base path; change `/login` redirects to `authMode = 'unauthenticated'` |
| `src/routes/connect/+page.svelte` | Remove join-request imports/state/handlers/templates; remove `addCollaborator` import; remove "Not a collaborator" panel; update `/login` redirects |
| `src/routes/journal/+page.svelte` | Remove `InvitesBadge` import and `<InvitesBadge />` |
| `src/routes/session-end/+page.svelte` | Remove `InvitesBadge`; update expired redirect |
| `src/routes/timeline/+page.svelte` | Remove `InvitesBadge` |
| `src/routes/invite/+page.svelte` | Update "Login with GitHub instead" footer link |
| `src/routes/settings/+page.svelte` | Update `/login` redirects |
| `src/lib/git/github-client.ts` | Remove `addCollaborator` function |
| `tests/git/github-client.test.ts` | Remove `addCollaborator` tests |
| `src/lib/stores/github.ts` | Remove `'oauth'` from `AuthMethod` |
| `.github/workflows/deploy.yml` | Swap OAuth env vars for `PUBLIC_GAME_INVITE_CODE` |
| `src/routes/setup/+page.svelte` | Update footer link, add expired banner, remove "Administration" permission bullet |

---

## Task 1: Delete dead files

**Files:**
- Delete: `src/routes/login/+page.svelte`
- Delete: `src/lib/invites/invite-client.ts`
- Delete: `src/lib/invites/invite-url.ts`
- Delete: `src/lib/components/InvitesBadge.svelte`
- Delete: `tests/invites/invite-client.test.ts`
- Delete: `tests/invites/invite-url.test.ts`
- Delete: `tools/oauth-worker.js`
- Delete: `tools/wrangler.toml`
- Delete: `tools/README.md`
- Delete: `.env.example`

- [ ] **Step 1: Delete all files**

```bash
git rm src/routes/login/+page.svelte
git rm src/lib/invites/invite-client.ts
git rm src/lib/invites/invite-url.ts
git rm src/lib/components/InvitesBadge.svelte
git rm tests/invites/invite-client.test.ts
git rm tests/invites/invite-url.test.ts
git rm tools/oauth-worker.js
git rm tools/wrangler.toml
git rm tools/README.md
git rm .env.example
```

Also delete the local `.env` file (gitignored, won't show in git rm):

```bash
rm -f .env
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: delete OAuth artifacts, join-request system, and login page"
```

**Note:** The build will be broken after this commit because other files still import from deleted modules. That's OK — Tasks 2-4 fix all the consumers. Tests will also fail until consumers are cleaned up.

---

## Task 2: Clean `connect/+page.svelte` — remove join-request and direct-invite code

**Files:**
- Modify: `src/routes/connect/+page.svelte`

This is the biggest cleanup task. The connect page currently has: Pending Invites section, Not-a-collaborator panel, Invite a Player form, plus all their state/handlers. All of that gets removed. The invite-code generation section and the core connect/fork/join functionality stay.

- [ ] **Step 1: Read the file** to map what needs removal

Read `src/routes/connect/+page.svelte`. You need to remove:

**Imports to remove:**
- `listJoinRequests`, `approveJoinRequest`, `denyJoinRequest`, `type JoinRequest` from `$lib/invites/invite-client`
- `buildJoinRequestUrl` from `$lib/invites/invite-url`
- `addCollaborator` from `$lib/git/github-client` (remove just `addCollaborator` from the import, keep the rest)

**State variables to remove:**
- `pendingInvites`, `invitesLoading`, `inviteError`, `denyingIssue`, `denyReason`, `inviteActionError`
- `inviteUsername`, `inviteSending`, `inviteResult`
- `showRequestAccess`, `requestAccessOwner`, `requestAccessRepo`, `requestAccessBlockedUrl`

**Functions to remove:**
- `pollInvites`
- `handleApprove`
- `startDeny`, `cancelDeny`, `confirmDeny`
- `handleDirectInvite`
- `openRequestAccess`, `closeRequestAccess`
- `formatRelativeTime`

**From `onMount`:** remove the `pollInvites();` call at the end.

**From `handleJoinWorld`:** remove the `if (!validation.canWrite)` branch that sets `showRequestAccess`. Just keep the `if (!validation.valid)` check and the `await connectToRepo(...)` call.

**From `handleJoinPublicWorld`:** remove the `validateRepo` + `canWrite` check that was added. Revert to calling `connectToRepo('CYOAGame', 'Public_Game')` directly (the original behavior before the join-request feature).

**Template sections to remove:**
- The entire `{#if pendingInvites.length > 0 || invitesLoading}` section (Pending Invites)
- The entire `<!-- Direct Invite -->` section
- The entire `{#if showRequestAccess}` section (Not a collaborator panel)

**CSS rules to remove:**
- `.invite-card`, `.invite-header`, `.invite-avatar`, `.invite-meta`, `.invite-user`, `.invite-repo`, `.invite-sub`, `.deny-reason`, `.deny-reason:focus`, `.invite-actions`, `.invite-actions .btn`
- `.invite-form`, `.invite-form .field-input`, `.invite-form .btn`, `.invite-result`

**Keep everything related to:** the Invite Link generation section (which uses `invite-code.ts`, not `invite-client.ts`), the core connect/fork/join/sync functionality, the `AuthExpiredError` handling.

- [ ] **Step 2: Make all the removals**

Work through the file systematically: imports first, then state, then functions, then template, then CSS.

- [ ] **Step 3: Also remove the `authMethod === 'pat'` gate on `handleCreateWorld`**

Find the `handleCreateWorld` function. It currently starts with:

```typescript
if ($githubState.authMethod === 'pat') {
    forkError = 'Create World requires "Login with GitHub"...';
    return;
}
```

Remove that entire if-block. PAT is now the only auth method, so the gate is meaningless. Keep the rest of `handleCreateWorld` as-is (it still tries `forkRepo` which may fail for scoped PATs — the existing error handling covers that).

- [ ] **Step 4: Run typecheck**

Run: `npm run check`
Expected: errors in files that still import from deleted modules (github-client.test.ts for addCollaborator, gameplay pages for InvitesBadge, etc.) will show up. Errors IN connect/+page.svelte should be zero. Note the pre-existing 49 Svelte 5 rune errors are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/routes/connect/+page.svelte
git commit -m "refactor: remove join-request and direct-invite code from connect page"
```

---

## Task 3: Clean gameplay pages — remove InvitesBadge

**Files:**
- Modify: `src/routes/journal/+page.svelte`
- Modify: `src/routes/session-end/+page.svelte`
- Modify: `src/routes/timeline/+page.svelte`

- [ ] **Step 1: Remove InvitesBadge from each file**

For each of the three files:
1. Remove the import: `import InvitesBadge from '$lib/components/InvitesBadge.svelte';`
2. Remove the component instance: `<InvitesBadge />`
3. Remove any CSS rules targeting `:global(.invites-badge)` if present.

Do NOT touch anything else in these files. Pre-existing Svelte 5 rune errors remain unchanged.

- [ ] **Step 2: Commit**

```bash
git add src/routes/journal/+page.svelte src/routes/session-end/+page.svelte src/routes/timeline/+page.svelte
git commit -m "refactor: remove InvitesBadge from gameplay pages"
```

---

## Task 4: Remove `addCollaborator` from `github-client.ts`

**Files:**
- Modify: `src/lib/git/github-client.ts`
- Modify: `tests/git/github-client.test.ts`

- [ ] **Step 1: Remove `addCollaborator` from github-client.ts**

Find and delete the entire `addCollaborator` function (starts with the JSDoc comment, ends with the closing `}`). It's at the bottom of the file, after `syncFork`.

- [ ] **Step 2: Remove `addCollaborator` tests from github-client.test.ts**

Find the `describe('addCollaborator', ...)` block and delete it entirely. Also remove `addCollaborator` from the import line at the top of the test file.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: tests pass. The test count will drop (lost invite-client, invite-url, and addCollaborator tests). Note the new count.

- [ ] **Step 4: Commit**

```bash
git add src/lib/git/github-client.ts tests/git/github-client.test.ts
git commit -m "refactor: remove addCollaborator from github-client"
```

---

## Task 5: Rename `/login/pat-wizard` → `/setup`

**Files:**
- Rename: `src/routes/login/pat-wizard/+page.svelte` → `src/routes/setup/+page.svelte`
- Rename: `src/routes/login/pat-wizard/wizard-state.ts` → `src/routes/setup/wizard-state.ts`
- Rename: `tests/routes/pat-wizard-state.test.ts` → `tests/routes/setup-wizard-state.test.ts`
- Delete: `src/routes/login/` directory (empty after the rename)

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/routes/setup
mv src/routes/login/pat-wizard/+page.svelte src/routes/setup/+page.svelte
mv src/routes/login/pat-wizard/wizard-state.ts src/routes/setup/wizard-state.ts
mv tests/routes/pat-wizard-state.test.ts tests/routes/setup-wizard-state.test.ts
rmdir src/routes/login/pat-wizard
rmdir src/routes/login
```

- [ ] **Step 2: Update the test import path**

In `tests/routes/setup-wizard-state.test.ts`, change the import from:

```typescript
} from '../../src/routes/login/pat-wizard/wizard-state';
```

to:

```typescript
} from '../../src/routes/setup/wizard-state';
```

- [ ] **Step 3: Update the wizard page internals**

In `src/routes/setup/+page.svelte`:

1. Change the footer link from `<a href="{base}/login" ...>Back to login</a>` to `<a href="{base}/" ...>Back to home</a>`.

2. Remove the "Administration: Read and write" optional bullet from the permissions list (if it exists — it may have been added as part of the invite feature). The `<ul>` in step 2 should list only:
   - Contents: Read and write
   - Metadata: Read (already required)
   - Pull requests: Read and write

3. Remove or update the join-step1 text that says "or use Login with GitHub" — change to just "ask the world owner to add you."

4. Add expired-token banner handling. At the top of the `<script>`, import `page`:

```typescript
import { page } from '$app/state';
```

Add a state variable:

```typescript
let expiredMessage = $state('');
```

In `onMount`, check for the `?error=expired` param:

```typescript
onMount(() => {
    if (page.url.searchParams.get('error') === 'expired') {
        expiredMessage = 'Your PAT expired or was revoked. Please create a new one and reconnect.';
    }
    const restored = loadWizardState();
    if (restored) state = restored;
});
```

(Note: the variable might be named `wizState` instead of `state` due to a Svelte 5 rune collision workaround — check the file and use whichever name is in use.)

In the template, at the top of the `.wizard-inner` div (before the header), add:

```svelte
{#if expiredMessage}
    <p class="error-msg">{expiredMessage}</p>
{/if}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: wizard state machine tests still pass with updated import path. Note the test count.

- [ ] **Step 5: Typecheck**

Run: `npm run check`
Expected: no new errors from the rename. Wizard page compiles at `/setup`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: rename /login/pat-wizard to /setup"
```

---

## Task 6: Update `AuthMethod` type + all `/login` redirects

**Files:**
- Modify: `src/lib/stores/github.ts`
- Modify: `src/routes/+page.svelte`
- Modify: `src/routes/connect/+page.svelte`
- Modify: `src/routes/session-end/+page.svelte`
- Modify: `src/routes/settings/+page.svelte`
- Modify: `src/routes/invite/+page.svelte`

- [ ] **Step 1: Update `AuthMethod` in github.ts**

In `src/lib/stores/github.ts`, change:

```typescript
export type AuthMethod = 'oauth' | 'pat' | 'invite-code' | null;
```

to:

```typescript
export type AuthMethod = 'pat' | 'invite-code' | null;
```

- [ ] **Step 2: Update `src/routes/+page.svelte`**

Find the `onMount` block. Change the two redirects to `/login`:

```typescript
// Line ~78: token invalid
clearAuth();
goto(`${base}/login`);
```
→
```typescript
clearAuth();
authMode = 'unauthenticated';
```

```typescript
// Line ~83: not logged in
goto(`${base}/login`);
```
→
```typescript
authMode = 'unauthenticated';
```

Also find and fix the invite link base-path bug (around line 32):

```typescript
inviteLink = `${origin}/invite?code=${code}`;
```
→
```typescript
inviteLink = `${origin}${base}/invite?code=${code}`;
```

Also update the `unauthenticated` template branch (around line 1748):

```svelte
<a href="{base}/login" class="btn btn-primary">Login with GitHub</a>
```
→ this entire branch gets replaced in Task 8 (the landing page task). For NOW, just change it to:

```svelte
<a href="{base}/setup" class="btn btn-primary">Set Up Your World</a>
```

- [ ] **Step 3: Update `src/routes/connect/+page.svelte`**

Find all `goto(\`${base}/login\`)` calls and change to `goto(\`${base}/\`)` (landing page).

Find all `goto(\`${base}/login?error=expired\`)` calls and change to branch on authMethod:

```typescript
if ($githubState.authMethod === 'pat') {
    goto(`${base}/setup?error=expired`);
} else {
    goto(`${base}/?error=invite-expired`);
}
```

Apply this pattern to EVERY catch block that currently redirects to `/login?error=expired`. There are multiple instances — check all catch blocks in the file.

Also find `handleLogout` and change:

```typescript
goto(`${base}/login`);
```
→
```typescript
goto(`${base}/`);
```

- [ ] **Step 4: Update `src/routes/session-end/+page.svelte`**

Find the `AuthExpiredError` catch block and change:

```typescript
goto(`${base}/login?error=expired`);
```
→
```typescript
if ($githubState.authMethod === 'pat') {
    goto(`${base}/setup?error=expired`);
} else {
    goto(`${base}/?error=invite-expired`);
}
```

- [ ] **Step 5: Update `src/routes/settings/+page.svelte`**

Find all `goto(\`${base}/login...\`)` calls:
- `goto(\`${base}/login?error=expired\`)` → same branching pattern as above
- `<a href="{base}/login" ...>` → change to `<a href="{base}/setup" ...>Set up GitHub sync</a>` or similar

- [ ] **Step 6: Update `src/routes/invite/+page.svelte`**

Find the footer link:

```svelte
<a href="{base}/login" class="footer-link">Login with GitHub instead</a>
```
→
```svelte
<a href="{base}/setup" class="footer-link">Set up your own world</a>
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npm test && npm run check`
Expected: all tests pass, no new typecheck errors. The `'oauth'` string should appear nowhere in `src/` after this task.

Verify: `grep -rn "'oauth'" src/` — should return zero matches.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/github.ts src/routes/+page.svelte src/routes/connect/+page.svelte src/routes/session-end/+page.svelte src/routes/settings/+page.svelte src/routes/invite/+page.svelte
git commit -m "refactor: remove oauth auth method, redirect all /login refs to /setup or /"
```

---

## Task 7: Update deploy workflow

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Swap env vars**

In `.github/workflows/deploy.yml`, find the build step's `env:` block:

```yaml
      - run: npm run build
        env:
          BASE_PATH: '/${{ github.event.repository.name }}'
          PUBLIC_GITHUB_CLIENT_ID: ${{ secrets.PUBLIC_GITHUB_CLIENT_ID }}
          PUBLIC_OAUTH_WORKER_URL: ${{ secrets.PUBLIC_OAUTH_WORKER_URL }}
```

Replace with:

```yaml
      - run: npm run build
        env:
          BASE_PATH: '/${{ github.event.repository.name }}'
          PUBLIC_GAME_INVITE_CODE: ${{ secrets.PUBLIC_GAME_INVITE_CODE }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: swap OAuth env vars for PUBLIC_GAME_INVITE_CODE"
```

---

## Task 8: Expand root page `unauthenticated` branch into landing page

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Add the invite code import**

At the top of the `<script>` block, add:

```typescript
import { PUBLIC_GAME_INVITE_CODE } from '$env/static/public';
```

- [ ] **Step 2: Add error handling for invite-expired**

Near the existing `$effect` block that handles `isOffline`, add another effect:

```typescript
$effect(() => {
    const error = page.url.searchParams.get('error');
    if (error === 'invite-expired') {
        authMode = 'unauthenticated';
    }
});
```

Add a derived value for the error message:

```typescript
let inviteExpiredError = $derived(
    page.url.searchParams.get('error') === 'invite-expired'
        ? 'Your invite link has expired or was revoked. Ask the world owner for a new one.'
        : ''
);
```

- [ ] **Step 3: Replace the `unauthenticated` template branch**

Find the current `{:else if authMode === 'unauthenticated'}` block (around line 1746) and replace its contents:

```svelte
{:else if authMode === 'unauthenticated'}
    {#if inviteExpiredError}
        <p class="error-msg">{inviteExpiredError}</p>
    {/if}

    <p class="description">
        Interactive fiction where your choices shape a persistent world.
        Progress saves as git commits. Play solo offline or with friends
        in a shared world.
    </p>

    <div class="actions">
        <a href="{base}/?offline=true" class="btn btn-primary">Play Offline</a>
        {#if PUBLIC_GAME_INVITE_CODE}
            <a href="{base}/invite?code={PUBLIC_GAME_INVITE_CODE}" class="btn btn-primary">
                Join the Public World
            </a>
        {/if}
    </div>

    <div class="host-section">
        <h2 class="host-title">Host your own world</h2>
        <ol class="host-steps">
            <li>
                <a href="https://github.com/CYOAGame/ironhaven" target="_blank" rel="noopener noreferrer">
                    Fork CYOAGame/ironhaven
                </a>
                on GitHub
            </li>
            <li>
                <a href="https://github.com/settings/personal-access-tokens/new?description=Journal+RPG" target="_blank" rel="noopener noreferrer">
                    Create a fine-grained PAT
                </a>
                for your fork with these permissions:
                <ul class="perm-list">
                    <li><strong>Contents:</strong> Read and write</li>
                    <li><strong>Metadata:</strong> Read (default)</li>
                    <li><strong>Pull requests:</strong> Read and write</li>
                </ul>
            </li>
            <li>
                <a href="{base}/setup">Connect to the game</a>
                — paste your PAT and select your fork
            </li>
            <li>
                From the Connect page, click <strong>Generate Invite Link</strong>
                and share it with friends. They click the link, pick a name, and
                play — no GitHub account needed.
            </li>
        </ol>
    </div>

    <div class="footer-links-landing">
        <a href="{base}/setup" class="settings-link">Already set up? Go to Setup</a>
    </div>
```

- [ ] **Step 4: Add CSS for the new landing sections**

Append to the `<style>` block (before `</style>`):

```css
    .host-section {
        margin-top: 2rem;
        text-align: left;
        max-width: 480px;
        width: 100%;
    }
    .host-title {
        font-size: 1.1rem;
        color: var(--journal-accent);
        font-weight: normal;
        letter-spacing: 0.04em;
        margin: 0 0 1rem 0;
    }
    .host-steps {
        font-size: 0.88rem;
        line-height: 1.8;
        padding-left: 1.2rem;
        margin: 0;
        opacity: 0.85;
    }
    .host-steps a {
        color: var(--journal-accent);
    }
    .host-steps li {
        margin-bottom: 0.75rem;
    }
    .perm-list {
        margin: 0.4rem 0 0 0;
        padding-left: 1.2rem;
        font-size: 0.85rem;
    }
    .perm-list li {
        margin-bottom: 0.2rem;
    }
    .footer-links-landing {
        margin-top: 1.5rem;
        display: flex;
        gap: 1.5rem;
        justify-content: center;
    }
    .error-msg {
        color: #e09090;
        background: rgba(180, 60, 60, 0.15);
        border: 1px solid rgba(180, 60, 60, 0.4);
        border-radius: 4px;
        padding: 0.5rem 0.75rem;
        font-size: 0.85rem;
        text-align: center;
        max-width: 480px;
        width: 100%;
    }
```

Note: `.error-msg` may already exist in the file's `<style>` block. If so, don't duplicate it — just verify the existing one looks reasonable.

- [ ] **Step 5: Typecheck**

Run: `npm run check`

If `PUBLIC_GAME_INVITE_CODE` causes a build error (because `$env/static/public` fails when the variable is missing), you need to add a fallback for local dev. Create a `.env` file:

```
PUBLIC_GAME_INVITE_CODE=
```

An empty value means the "Join the Public World" button won't render (it's behind `{#if PUBLIC_GAME_INVITE_CODE}`), but the page will build. Commit the `.env` check to the plan notes, not to git (`.env` is gitignored).

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all remaining tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: add landing page content for unauthenticated visitors"
```

---

## Task 9: Manual verification

**Files:** none modified.

- [ ] **Step 1: Run all automated checks**

```bash
npm test && npm run check
```

Expected: all tests pass, no new typecheck errors.

- [ ] **Step 2: Verify no stale references**

```bash
grep -rn "'oauth'" src/
grep -rn "/login" src/ | grep -v node_modules | grep -v '.svelte-kit'
grep -rn "InvitesBadge" src/
grep -rn "invite-client" src/
grep -rn "invite-url" src/ | grep -v invite-code
grep -rn "addCollaborator" src/
```

All should return zero matches (except `/login` might appear in the `github.com/login/oauth/authorize` URL in deleted files — verify it's not in any active source file).

- [ ] **Step 3: Start dev server and test**

Run: `npm run dev`

**Landing page (unauthenticated):**
- Open `http://localhost:5173/` in a private window
- Should see: Journal RPG title, description, Play Offline button, hosting tutorial
- "Join the Public World" button only shows if `PUBLIC_GAME_INVITE_CODE` is set in `.env`
- Click "Play Offline" → works (existing flow)
- Click "Connect to the game" link → navigates to `/setup`

**Setup wizard:**
- `/setup` shows the PAT wizard (same behavior as old `/login/pat-wizard`)
- Footer link says "Back to home" and goes to `/`
- No "Login with GitHub" references anywhere
- Permissions list has 3 items (no Administration)
- `/setup?error=expired` shows the expired banner

**Invite flow:**
- Open an invite link → `/invite?code=...` → shows name entry → works
- Footer says "Set up your own world" (not "Login with GitHub")

**Game menu (authenticated):**
- After connecting via PAT wizard, root page shows the game dashboard (Continue World, Switch World, etc.)
- Invite link generation still works
- Settings page has no "Login with GitHub" references

**Deleted routes:**
- `/login` returns 404 (or the SPA fallback renders nothing useful)

**Expired token handling:**
- For a PAT host: revoking the token mid-session → redirect to `/setup?error=expired`
- For an invite-code player: revoking the host's token mid-session → redirect to `/?error=invite-expired` with the banner

- [ ] **Step 4: Fix anything that breaks**

If manual testing surfaces issues, fix in targeted commits.

---

## Final self-review checklist

- [ ] All spec sections have at least one task:
  - Landing page → Task 8
  - OAuth deletion → Task 1
  - Join-request deletion → Tasks 1, 2, 3, 4
  - PAT wizard rename → Task 5
  - AuthMethod update → Task 6
  - Redirect updates → Task 6
  - Deploy workflow → Task 7
  - Manual verification → Task 9
- [ ] No task contains TODO/TBD/placeholder text
- [ ] File paths are consistent across tasks
- [ ] Every commit step has an exact `git add` + `git commit -m` pair
- [ ] No Claude attribution in commit messages

---

## Out of scope

- Fancy landing page design (animations, illustrations) — plain dark aesthetic matching existing pages
- Custom domain configuration
- Analytics
- Blog or changelog
