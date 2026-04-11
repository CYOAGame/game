# Owner-Approved Join Invites

**Date:** 2026-04-11
**Status:** Design approved, ready for implementation planning
**Depends on:** `2026-04-11-github-auth-redesign.md` (landed on `main` as of commit `8e9d0cc`)

## Problem

After the GitHub auth redesign shipped, a new player wanting to play in a
public shared world (e.g. `CYOAGame/Public_Game`) hits a cold-start problem.
They can authenticate the game perfectly — via OAuth or the PAT wizard — but
they still can't *save* progress in the shared world because they're not a
GitHub collaborator on the target repo. Collaborator status is a hard GitHub
requirement for pushing, regardless of auth method.

Today, every new player requires the world owner to manually add them via
`github.com/<owner>/<repo>/settings/access`. That's friction on the owner
side, and a dead-end surprise on the player side (the game looks like it's
working, then silently fails on the first save with a 403).

## Goals

- Let a player request access to a public world from inside the game with
  one click, without requiring them to have *any* game-side authentication
  yet.
- Let the world owner see pending requests inside the game (no round-trip to
  github.com) and approve or deny them with one tap.
- Make the full "player arrives → asks to join → owner approves → player
  plays" loop achievable without either party leaving their normal workflow.

## Non-goals (out of scope for this spec)

- **Private worlds.** Non-collaborators can't even see private repos, let
  alone open issues on them. Supporting private auto-join requires a GitHub
  App with collaborator-management permissions per installed repo. That's a
  separate, larger feature.
- **Auto-approve toggle.** A "this world accepts anyone who asks" mode that
  bypasses owner approval. Useful for genuinely public showcase worlds but
  adds a new setting surface + abuse concerns. Layerable on top of this MVP
  later.
- **Multi-world polling.** This spec only polls for pending invites on the
  *currently-connected* world, not across all worlds the owner has ever
  touched.
- **Rich request messages.** The player submits an issue with an empty
  body; they can freeform-type into it on github.com if they want, but the
  game doesn't ask for or display any "message" field.
- **Rate-limiting the "Request access" button.** A malicious player could
  click it 100 times and open 100 tabs. GitHub's own issue-creation rate
  limits are the backstop.

## Scope

This spec covers end-to-end invites for **public** worlds: the player's
request submission path, the owner's review UI, and the approval/denial
actions. It does not cover private worlds, auto-approve, or any new GitHub
infrastructure beyond issues and the existing collaborators API.

## Architecture

### Request channel

A GitHub Issue on the target repo, labeled `journal-rpg/join-request`:

- **Who can create it:** any logged-in GitHub user (public repos allow
  issue creation by anyone).
- **Source of truth for "who wants in":** `issue.user.login` — the issue
  author, as reported by GitHub. **Never** the title or body. This closes
  two problems at once: (1) impersonation is impossible (GitHub verified
  the author), and (2) nothing the player types can affect the approval
  flow.
- **Label:** `journal-rpg/join-request`. Using a namespaced label avoids
  collisions with any existing labels the world owner already uses.
- **Issue title:** `Join request` (generic — the player can customize if
  they want, we don't read it).
- **Issue body:** prefilled by the pre-filled URL with a one-liner
  explaining what this issue is and a link back to the game. The player
  can edit before submitting.

### Request submission: pre-filled github.com URL

When the player tries to connect to a public world and `validateRepo`
returns `{ valid: true, canWrite: false }`, the Connect page shows a new
"Not a collaborator yet" panel with a single primary action: **Request
access**. That button opens `window.open(buildJoinRequestUrl(owner, repo,
appUrl), '_blank')`, which points to
`https://github.com/<owner>/<repo>/issues/new?labels=journal-rpg/join-request&title=Join+request&body=<prefilled>`.

The player:
1. Lands on GitHub (usually already logged in).
2. Reviews the pre-filled issue, optionally edits.
3. Clicks "Submit new issue."
4. Closes the tab and returns to the game.

The player's game-side state is unchanged — the game never sees any
evidence that the request happened. The player is told: *"Request
submitted. Once the owner approves, GitHub will email you an invite.
Accept it on github.com, then reload this page."*

The player's game token isn't used for the issue creation — github.com's
own session authenticates that. This means the game-side auth method
(OAuth or fine-grained PAT) doesn't matter for this flow: a PAT user
whose token has no access to `CYOAGame/Public_Game` can still request
access to it, because the request is submitted by github.com, not by the
game. (The player still needs game auth to reach `/connect` in the first
place — this spec doesn't change the existing "login required to see the
world picker" requirement.)

### Request review: pending invites on `/connect` and a badge during gameplay

On every `/connect` page load, if the user is authenticated with a token
capable of writing to the currently-connected world, the game calls
`listJoinRequests(token, owner, repo)` which wraps
`octokit.rest.issues.listForRepo({ labels: 'journal-rpg/join-request', state: 'open' })`.

Issues with `issue.pull_request` set are filtered out (GitHub's issues
endpoint returns PRs too). Each remaining issue becomes a `JoinRequest`:

```typescript
interface JoinRequest {
    issueNumber: number;
    username: string;   // from issue.user.login
    avatarUrl: string;  // from issue.user.avatar_url
    submittedAt: string; // ISO date from issue.created_at
    repoOwner: string;
    repoName: string;
}
```

If any are returned, a new "Pending Invites" section renders at the top
of `/connect` with one card per request:

```
┌─────────────────────────────────────────┐
│ [avatar] alice                          │
│ wants to join CYOAGame/Public_Game      │
│ submitted 2 hours ago                   │
│                                         │
│  [Approve]  [Deny]                      │
└─────────────────────────────────────────┘
```

A small `<InvitesBadge>` component is also rendered in the header of the
main gameplay pages (`journal`, `session-end`, `timeline`). It polls on
mount (once per route navigation, no background polling), shows
`"{N} pending invite{s}"` when `N > 0`, and navigates to `/connect` on
click. When there are zero invites, the badge renders nothing.

### Approval action

When the owner taps **Approve** on a card, the game calls
`approveJoinRequest(token, req)` which orchestrates three GitHub API
calls:

1. `repos.addCollaborator({ owner, repo, username: req.username, permission: 'push' })`
2. `issues.createComment({ owner, repo, issue_number: req.issueNumber, body: "Welcome! You've been added as a collaborator. You should receive an email invite shortly — accept it to start playing." })`
3. `issues.update({ owner, repo, issue_number: req.issueNumber, state: 'closed' })`

If step 1 fails, the function stops and returns the error — steps 2 and
3 do not run. If steps 2 or 3 fail after step 1 succeeded, the error is
swallowed (logged to console) and the function still returns success. The
rationale: the collaborator was added (the user-visible outcome), so
failing to close the issue is a UI-staleness bug, not a correctness bug.
The next poll will see the still-open issue, but step 1 would already
succeed idempotently via the "user already a collaborator" path below.

On success, the card is removed from the list and a re-poll runs.

### Denial action

When the owner taps **Deny**, a small textarea appears under the card:
*"Optional reason (shown to the requester):"*. Once submitted, the game
calls `denyJoinRequest(token, req, reason)`:

1. `issues.createComment(..., { body: reason ?? "Your request was not approved at this time." })`
2. `issues.update(..., { state: 'closed' })`

No collaborator is touched. On success, the card is removed from the
list.

### Permission requirements for owners

Approving a request requires the `POST /repos/{owner}/{repo}/collaborators/{username}`
endpoint, which needs **admin** (or maintain) permission on the repo.

- **OAuth (`repo` scope):** includes admin on any repo the user owns.
  Works out of the box.
- **Fine-grained PAT:** works only if the PAT was created with
  **Administration: Read and write** on the target repo. Only repo admins
  can grant that permission when creating a fine-grained PAT, so the
  wizard-generated PATs for non-admin collaborators simply won't have
  this capability — and those users can't approve invites anyway (they
  lack admin rights at the GitHub level, regardless of our UI).

The PAT wizard's Step 2 permission list will be updated to include
**Administration: Read and write** as an *optional* permission with the
note *"Only needed if you plan to approve join requests from other players
for this repo."* Skeptical users who only want to play their own solo
world can skip it; world owners who want invite approval can include it.

In the `/connect` Pending Invites section, the approve button's click
handler detects a 403 from `addCollaborator` and surfaces an inline error:
*"Can't add collaborator — your token lacks admin permission on this repo.
Log in via 'Login with GitHub' to approve, or re-create your PAT with
Administration: Read and write."*

### Player journey end-to-end

```
1. Player opens https://cyoagame.github.io/game/
2. /login → authenticates the game (OAuth or PAT wizard)
3. /connect → taps "Join Public World" (CYOAGame/Public_Game)
4. validateRepo returns { valid: true, canWrite: false }
5. Connect page shows "Not a collaborator yet" panel
6. Player clicks "Request access" → new tab opens pre-filled issue page
7. Player reviews, submits the issue
8. Player returns to game; sees "Request submitted — waiting for approval"
9. Player eventually receives a GitHub collaborator-invite email
10. Player clicks the link, accepts on github.com
11. Player reloads the game → validateRepo now returns canWrite: true → proceed
```

### Owner journey end-to-end

```
1. Owner loads /connect (starting a session or switching worlds)
2. Game calls listJoinRequests for the currently-connected world
3. Pending Invites section renders with N cards
4. Owner taps "Approve" on alice's card
5. Game calls approveJoinRequest → add + comment + close
6. Card disappears; re-poll confirms
7. Alice eventually accepts the invite and plays

During gameplay on journal/session-end/timeline pages:
8. InvitesBadge polls on route mount
9. If N > 0, badge renders "(N) pending invites"
10. Owner taps badge → navigates to /connect → loop back to step 3
```

## Components

### New files

| Path | Responsibility |
|---|---|
| `src/lib/invites/invite-client.ts` | `listJoinRequests`, `approveJoinRequest`, `denyJoinRequest`, `JOIN_REQUEST_LABEL` constant. Each API call routed through `handleRequest` from `github-client.ts` so 401s promote to `AuthExpiredError`. |
| `src/lib/invites/invite-url.ts` | `buildJoinRequestUrl(owner, repo, appUrl)` — pure string builder, fully unit-testable. |
| `src/lib/components/InvitesBadge.svelte` | Shared component: polls on mount, renders `"{N} pending invites"` button, navigates to `/connect` on click. |
| `tests/invites/invite-client.test.ts` | Client wrapper tests with function-injected fake Octokit. |
| `tests/invites/invite-url.test.ts` | Pure function tests: encoding, label, body format. |

### Modified files

| Path | Change |
|---|---|
| `src/lib/git/github-client.ts` | Add `addCollaborator(token, owner, repo, username)` wrapper that routes through `handleRequest`. Treats 422 ("already a collaborator") as success. |
| `src/routes/connect/+page.svelte` | Add "Pending Invites" section at top. Extend `handleJoinWorld` to detect `!canWrite` and show a "Not a collaborator yet" panel with the Request Access button. Replace the existing "Repository not found" branch. |
| `src/routes/login/pat-wizard/+page.svelte` | Add "Administration: Read and write" as an optional bullet in both `create-step2` and `join-step2` permission lists, with the explanatory note. |
| `src/routes/journal/+page.svelte` | Drop `<InvitesBadge />` into the page header. |
| `src/routes/session-end/+page.svelte` | Same. |
| `src/routes/timeline/+page.svelte` | Same. |
| `docs/superpowers/specs/2026-04-11-github-auth-redesign.md` | Mark "Owner-approved invites" under Future Work as in-progress with a link to this spec. |

### API surface summary

```typescript
// src/lib/invites/invite-client.ts

export const JOIN_REQUEST_LABEL = 'journal-rpg/join-request';

export interface JoinRequest {
    issueNumber: number;
    username: string;
    avatarUrl: string;
    submittedAt: string;
    repoOwner: string;
    repoName: string;
}

export async function listJoinRequests(
    token: string,
    owner: string,
    repo: string
): Promise<JoinRequest[]>;

export async function approveJoinRequest(
    token: string,
    req: JoinRequest
): Promise<{ success: boolean; error?: string }>;

export async function denyJoinRequest(
    token: string,
    req: JoinRequest,
    reason?: string
): Promise<{ success: boolean; error?: string }>;

// src/lib/invites/invite-url.ts

export function buildJoinRequestUrl(
    owner: string,
    repo: string,
    appUrl: string
): string;

// src/lib/git/github-client.ts (addition)

export async function addCollaborator(
    token: string,
    owner: string,
    repo: string,
    username: string
): Promise<{ success: boolean; error?: string; alreadyCollaborator?: boolean }>;
```

## Error handling

| Scenario | Response |
|---|---|
| `listJoinRequests` 401 | `handleRequest` clears auth → `AuthExpiredError` → `/login?error=expired` (standard expiry flow) |
| `listJoinRequests` 403 (permissions too narrow to list issues on the repo) | Treat as "no invites" and hide the section; don't block the rest of `/connect` |
| `listJoinRequests` 404 | Treat as "no invites" (private repo or typo); don't block `/connect` |
| `addCollaborator` 401 | Same as above — `handleRequest` handles it |
| `addCollaborator` 403 (owner lacks admin permission) | Surface inline: *"Can't add collaborator — your token lacks admin permission on this repo. Log in via OAuth or re-create your PAT with Administration: R/W."* Do not comment/close the issue — the request stays pending. |
| `addCollaborator` 422 (user is already a collaborator) | Treat as success. Proceed to comment + close so the issue doesn't linger. |
| `addCollaborator` 404 (username doesn't exist) | Shouldn't happen — we got the username from `issue.user.login`, which GitHub itself vouched for. If it does, surface the error and close the issue with *"Couldn't find that GitHub user — something weird happened."* |
| Comment or close fails after successful `addCollaborator` | Swallow (log to console), report success. Next poll will re-fetch and self-correct. |
| `buildJoinRequestUrl` with malformed inputs | The function is pure and always returns *something* — no throws. Tests verify encoding of weird owner/repo names. |
| `window.open` blocked by browser | Show inline fallback: *"Your browser blocked the popup. Click [this link] to open the request page manually."* with a plain `<a href="..." target="_blank">`. |
| Player reaches `/connect` with no active session at all | Existing redirect to `/login` still applies — the invite flow never triggers without auth. |

## Testing plan

### Unit tests

- **`tests/invites/invite-url.test.ts`** (new)
  - Returns a URL with the expected host and path
  - Label is URL-encoded correctly
  - Owner/repo with unusual characters (hyphens, underscores) survive
  - Body includes the provided `appUrl`
  - Returns a string (never throws)

- **`tests/invites/invite-client.test.ts`** (new)
  - `listJoinRequests` filters out `issue.pull_request` items
  - `listJoinRequests` maps `issue.user.login` → `JoinRequest.username`
  - `approveJoinRequest` calls in order: `addCollaborator` → `createComment` → `update(state: closed)`
  - `approveJoinRequest` stops early on addCollaborator 403
  - `approveJoinRequest` proceeds on addCollaborator 422 (idempotent)
  - `denyJoinRequest` calls in order: `createComment` → `update(state: closed)`
  - Test fakes inject a minimal Octokit-shaped object rather than mocking the module

- **`tests/git/github-client.test.ts`** (extend)
  - `addCollaborator` 401 throws `AuthExpiredError`
  - `addCollaborator` 403 returns `{success: false, error: ...}`
  - `addCollaborator` 422 returns `{success: true, alreadyCollaborator: true}`

### Manual test checklist

- [ ] Player without a session navigates to the game, tries to join
      `CYOAGame/Public_Game`, sees the "Not a collaborator yet" panel.
- [ ] Clicking "Request access" opens a new tab at github.com with all
      fields pre-filled correctly (label, title, body).
- [ ] After player submits the issue, owner reloads `/connect` and sees
      the pending card.
- [ ] Owner taps Approve → card disappears → github.com shows a closed
      issue with the welcome comment → player's github.com notifications
      show a collaborator invite.
- [ ] Player accepts invite, reloads the game, proceeds into the world
      normally.
- [ ] Owner taps Deny with a reason → card disappears → github.com shows
      a closed issue with the reason comment → player gets no collaborator
      invite.
- [ ] Owner authenticated with a PAT that lacks Administration permission
      taps Approve → sees the inline permission error → issue stays open.
- [ ] `<InvitesBadge>` shows the right count on `journal` / `session-end`
      / `timeline` when invites are pending, and nothing when they aren't.
- [ ] Badge click navigates to `/connect` where the full list is visible.
- [ ] Session expiry during `listJoinRequests` (revoke the owner's token
      mid-session) redirects to `/login?error=expired`.

## Architectural notes

- **Why GitHub Issues as the request channel:** they're the only
  write-enabled endpoint on public repos that doesn't require collaborator
  status. Discussions would also work but aren't enabled on every repo by
  default. Issues are universally available.
- **Why a pre-filled github.com URL instead of in-app issue creation:**
  in-app submission would require the player to have an authenticated
  token with `Issues: Write` permission on a repo they don't own. Classic
  OAuth `repo` scope allows this; fine-grained PATs do not. The pre-filled
  URL sidesteps the whole token-permission question by letting GitHub's
  own session authenticate the issue creation. It also removes any
  "authenticate with the game first" friction from the request path.
- **Why `issue.user.login` and not issue body/title:** preventing
  impersonation. The issue author is GitHub-verified; anything else is
  user-typed text that a bad actor could fill with someone else's
  username to try to phish them into an unwanted collaborator invite.
- **Why only OAuth owners get the approve button (mostly):** the
  addCollaborator endpoint needs admin-level permission on the repo.
  OAuth's `repo` scope includes this for owned repos. Fine-grained PATs
  require explicit opt-in to Administration: R/W at creation time, which
  is why we list it as optional in the wizard — the skeptic who doesn't
  care about being a world owner skips it, the world owner who wants to
  approve invites includes it. The UI gracefully surfaces the permission
  error if someone taps Approve without admin rights.
- **Why poll on route mount instead of background polling:** simplicity.
  One poll per user navigation is the cheapest rate limit footprint and
  requires zero timer management, cleanup on unmount, or race condition
  handling. Background polling would be a premature optimization for
  a game where the owner rarely has more than a few requests per day.
- **Why close the issue after approval/denial:** keeps the pending list
  accurate. Re-polling will see only open issues, so closed = resolved.
  Also gives both parties a clean github.com paper trail.

## Future work

- **Auto-approve toggle.** A per-world setting (e.g., `.cyoa/auto-approve`
  file in the repo, or a localStorage flag) that, when enabled, makes
  `listJoinRequests` automatically call `approveJoinRequest` on every
  pending request. Turns public worlds into zero-friction onboarding.
  Abuse prevention via a rate limit (max N auto-approvals per hour) would
  be needed before this ships.
- **Multi-world polling.** Show pending invites across all worlds the
  owner has ever touched, not just the currently-connected one. Would
  require persisting a list of "owned worlds" in `githubState` or a new
  store.
- **Private world invites via GitHub App.** A separately-installable
  GitHub App with `Administration: Write` permission per repo. The app
  would mint installation tokens the worker can use to add collaborators
  without the owner's personal token. Enables private auto-join flows
  with a much narrower permission surface than OAuth.
- **Player-side status page.** A `/request-status` page that the player
  can bookmark to check whether their request was approved yet — would
  need either polling a file in the repo (requires public repo) or a
  separate backend. Low priority; the email-and-reload flow is fine.
- **Bulk approve/deny** for owners who return from vacation to 50
  pending requests.
