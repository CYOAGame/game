# Invite Code Design

## Problem

The current invite flow requires every player to have a GitHub account and create their own PAT or use OAuth. This is too much friction for casual players who just want to join a friend's world.

## Solution

The world owner generates a shareable invite link containing a base64-encoded PAT (scoped to that one repo). A new player clicks the link, enters a display name, and starts playing. No GitHub account required.

## Share Code Format

Base64-encoded JSON:

```json
{"repo": "ironhaven", "token": "github_pat_..."}
```

The repo owner is not included — it's discovered at redemption time by calling the GitHub API with the token. Specifically: call `GET /user` to get the token owner's username, then `GET /repos/{username}/{repo}` to confirm access. If the token owner isn't the repo owner (e.g., they're a collaborator), search the user's accessible repos to find the matching repo name and extract the actual owner.

## Owner Side: Generate Invite Link (Connect Page)

New section on `/connect` alongside the existing "Invite a Player" username form.

1. Owner clicks "Generate Invite Link"
2. Game encodes `{repo: githubState.repoName, token: githubState.token}` into base64
3. Constructs full URL: `${window.location.origin}/invite?code=BASE64STRING`
4. Displays the URL in a read-only field with a "Copy" button
5. Owner sends the link to their friend via any channel (Discord, text, etc.)

The existing invite-by-username form remains for owners who want to add GitHub collaborators directly.

## Player Side: `/invite` Route

New dedicated page at `/invite`.

**If `?code=` query param is present:**
1. Decode the base64 code to extract `{repo, token}`
2. Validate the token via GitHub API — confirm it can access the repo
3. Discover the repo owner from the API response
4. Show: "You've been invited to play in **[repo name]**"
5. Prompt for a display name (e.g., "Bob")
6. On "Join": store auth state locally, fetch world files, navigate to `/journal/setup`

**If no query param:**
1. Show a paste field for the invite code (not the full URL, just the code portion)
2. Same flow from step 1 above

**Validation errors:**
- Invalid base64 → "This invite link doesn't look right"
- Token can't access repo → "This invite has expired or the token was revoked"
- Network error → "Couldn't connect to GitHub — check your internet connection"

## Auth State Changes

`githubState` store:
- `authMethod` gains a third value: `'oauth' | 'pat' | 'invite-code'`
- New optional field: `displayName?: string` — the player's chosen display name, used for commit authoring

Stored in localStorage as with other auth methods.

## Commit Authoring

For `authMethod: 'invite-code'` players, commits use a custom author:
- **Name**: The `displayName` from auth state (e.g., "Bob")
- **Email**: `{displayName}@players.journal-rpg.local` (placeholder, required by Git)
- **Commit message prefix**: `[Bob] Character — Season, Day X, Year Y` (same pattern as current, using display name instead of GitHub username)

PR creation uses the PAT owner's GitHub identity (API requirement), but individual commits show the player's display name.

## Changes to `repo-writer.ts`

`commitToBranch` currently creates commits without explicit author info (defaults to the token owner). When `displayName` is provided, pass `author: { name, email }` to the GitHub create-commit API call.

`saveWithPR` currently takes `username` for commit message formatting. Accept an optional `displayName` override — when present, use it instead of `username` in the commit message prefix.

## Login Page Change

Add a "Have an invite link?" text link on `/login` pointing to `/invite`. No other changes to the OAuth or PAT wizard flows.

## Main Page / Continuation

Players authenticated via invite-code see the same "Continue World" button. The `authMethod` flag tells the app to use `displayName` for commit authoring. All other gameplay is identical.

## Files to Create

- `src/routes/invite/+page.svelte` — invite redemption page

## Files to Modify

- `src/lib/stores/github.ts` — add `'invite-code'` to authMethod, add `displayName` field
- `src/lib/git/repo-writer.ts` — pass custom author on commits when displayName provided
- `src/routes/connect/+page.svelte` — add "Generate Invite Link" section
- `src/routes/login/+page.svelte` — add "Have an invite link?" link

## Out of Scope

- Revoking invite codes (owner can revoke the PAT on GitHub directly)
- Multiple invite codes per world (owner regenerates as needed — same PAT, new link)
- Rate limiting or usage tracking on invite codes
- Encrypting beyond base64 obfuscation
