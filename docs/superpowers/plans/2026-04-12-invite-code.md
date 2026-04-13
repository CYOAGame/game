# Invite Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a world owner generate a shareable invite link containing their repo-scoped PAT, so friends can join with zero GitHub account — just a display name.

**Architecture:** Add `invite-code` auth method to the existing `githubState` store. New `/invite` route for player redemption. New "Generate Invite Link" section on `/connect` for owners. Modify `commitToBranch` to accept custom author. Encode/decode utilities handle base64 obfuscation.

**Tech Stack:** SvelteKit 5, TypeScript, Vitest, Octokit (existing)

---

### Task 1: Add invite-code auth method and displayName to githubState

**Files:**
- Modify: `src/lib/stores/github.ts`
- Test: `tests/stores/github.test.ts`

- [ ] **Step 1: Update AuthMethod type**

In `src/lib/stores/github.ts`, change line 3:

```typescript
export type AuthMethod = 'oauth' | 'pat' | 'invite-code' | null;
```

- [ ] **Step 2: Add displayName to GitHubState interface**

In `src/lib/stores/github.ts`, add `displayName` after `username` (line 8):

```typescript
export interface GitHubState {
	isAuthenticated: boolean;
	username: string;
	displayName?: string;
	token: string;
	authMethod: AuthMethod;
	repoOwner: string;
	repoName: string;
	isConnected: boolean;
	syncStatus: 'idle' | 'syncing' | 'synced' | 'pending' | 'error';
	syncError?: string;
	pendingChanges: PendingChange[];
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run check`
Expected: No new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/github.ts
git commit -m "feat: add invite-code auth method and displayName to GitHubState"
```

---

### Task 2: Create invite code encode/decode utilities

**Files:**
- Create: `src/lib/invites/invite-code.ts`
- Create: `tests/invites/invite-code.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/invites/invite-code.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { encodeInviteCode, decodeInviteCode } from '../../src/lib/invites/invite-code';

describe('encodeInviteCode', () => {
	it('encodes repo and token into a base64 string', () => {
		const code = encodeInviteCode('ironhaven', 'github_pat_abc123');
		expect(typeof code).toBe('string');
		expect(code.length).toBeGreaterThan(0);
		// Should not contain raw token text
		expect(code).not.toContain('github_pat_abc123');
	});

	it('produces a string safe for URLs', () => {
		const code = encodeInviteCode('ironhaven', 'github_pat_abc123+/=');
		// Should not contain URL-unsafe base64 chars
		expect(code).not.toMatch(/[+/=]/);
	});
});

describe('decodeInviteCode', () => {
	it('decodes back to original repo and token', () => {
		const code = encodeInviteCode('ironhaven', 'github_pat_abc123');
		const result = decodeInviteCode(code);
		expect(result).toEqual({ repo: 'ironhaven', token: 'github_pat_abc123' });
	});

	it('returns null for invalid base64', () => {
		const result = decodeInviteCode('not-valid!!!');
		expect(result).toBeNull();
	});

	it('returns null for valid base64 but wrong structure', () => {
		const code = btoa(JSON.stringify({ foo: 'bar' }));
		const result = decodeInviteCode(code);
		expect(result).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(decodeInviteCode('')).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `eval "$(direnv export bash 2>/dev/null)" && npm test -- tests/invites/invite-code.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement encode/decode**

Create `src/lib/invites/invite-code.ts`:

```typescript
export interface InvitePayload {
	repo: string;
	token: string;
}

export function encodeInviteCode(repo: string, token: string): string {
	const json = JSON.stringify({ repo, token });
	// Use base64url encoding (URL-safe, no padding)
	const base64 = btoa(json);
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeInviteCode(code: string): InvitePayload | null {
	try {
		if (!code) return null;
		// Restore standard base64 from base64url
		let base64 = code.replace(/-/g, '+').replace(/_/g, '/');
		while (base64.length % 4) base64 += '=';
		const json = atob(base64);
		const parsed = JSON.parse(json);
		if (typeof parsed.repo !== 'string' || typeof parsed.token !== 'string') return null;
		if (!parsed.repo || !parsed.token) return null;
		return { repo: parsed.repo, token: parsed.token };
	} catch {
		return null;
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `eval "$(direnv export bash 2>/dev/null)" && npm test -- tests/invites/invite-code.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/invites/invite-code.ts tests/invites/invite-code.test.ts
git commit -m "feat: add invite code encode/decode utilities"
```

---

### Task 3: Add custom author support to commitToBranch

**Files:**
- Modify: `src/lib/git/repo-writer.ts:164-212`

- [ ] **Step 1: Add optional author parameter to commitToBranch**

In `src/lib/git/repo-writer.ts`, update the `commitToBranch` function signature (line 164) to accept an optional author:

```typescript
export async function commitToBranch(
	token: string,
	owner: string,
	repo: string,
	characterId: string,
	files: Map<string, string>,
	message: string,
	author?: { name: string; email: string }
): Promise<{ success: boolean; sha?: string; error?: string }> {
```

- [ ] **Step 2: Pass author to createCommit call**

In the same function, update the `createCommit` call (around line 197) to include the author when provided:

```typescript
			const { data: newCommit } = await octokit.rest.git.createCommit({
				owner, repo, message, tree: newTree.sha, parents: [branch.sha],
				...(author ? { author } : {})
			});
```

- [ ] **Step 3: Add optional author parameter to saveWithPR**

Update the `saveWithPR` function signature (line 355) to accept and pass through the author:

```typescript
export async function saveWithPR(
	token: string,
	owner: string,
	repo: string,
	characterId: string,
	characterName: string,
	files: Map<string, string>,
	commitMessage: string,
	username?: string,
	author?: { name: string; email: string }
): Promise<{ success: boolean; sha?: string; prNumber?: number; error?: string }> {
```

And update the `commitToBranch` call inside `saveWithPR` (around line 374):

```typescript
	const commitResult = await commitToBranch(token, owner, repo, characterId, files, finalMessage, author);
```

- [ ] **Step 4: Verify types compile**

Run: `eval "$(direnv export bash 2>/dev/null)" && npm run check`
Expected: No new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/repo-writer.ts
git commit -m "feat: add custom author support to commitToBranch and saveWithPR"
```

---

### Task 4: Pass displayName as commit author from session-end page

**Files:**
- Modify: `src/routes/session-end/+page.svelte:180-187`

- [ ] **Step 1: Build author object when displayName is set**

In `src/routes/session-end/+page.svelte`, in the `saveSession` function, update the `saveWithPR` call block (around line 180-187). Replace:

```typescript
				const commitMsg = `${currentCharacter?.name ?? 'Unknown'} — ${session?.date.season}, Day ${session?.date.day}, Year ${session?.date.year}`;
				const result = await saveWithPR(
					ghState.token, ghState.repoOwner, ghState.repoName,
					session.characterId,
					currentCharacter?.name ?? 'Unknown',
					stateFiles, commitMsg,
					ghState.username
				);
```

With:

```typescript
				const commitMsg = `${currentCharacter?.name ?? 'Unknown'} — ${session?.date.season}, Day ${session?.date.day}, Year ${session?.date.year}`;
				const authorLabel = ghState.displayName ?? ghState.username;
				const author = ghState.displayName
					? { name: ghState.displayName, email: `${ghState.displayName.toLowerCase().replace(/\s+/g, '-')}@players.journal-rpg.local` }
					: undefined;
				const result = await saveWithPR(
					ghState.token, ghState.repoOwner, ghState.repoName,
					session.characterId,
					currentCharacter?.name ?? 'Unknown',
					stateFiles, commitMsg,
					authorLabel,
					author
				);
```

- [ ] **Step 2: Verify types compile**

Run: `eval "$(direnv export bash 2>/dev/null)" && npm run check`
Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/session-end/+page.svelte
git commit -m "feat: use displayName as commit author for invite-code players"
```

---

### Task 5: Add "Generate Invite Link" section to Connect page

**Files:**
- Modify: `src/routes/connect/+page.svelte`

- [ ] **Step 1: Add state variables and handler**

In the `<script>` block of `src/routes/connect/+page.svelte`, add after the existing invite-related state variables:

```typescript
	import { encodeInviteCode } from '$lib/invites/invite-code';

	let inviteLink = $state('');
	let inviteLinkCopied = $state(false);

	function generateInviteLink() {
		const ghState = $githubState;
		if (!ghState.token || !ghState.repoName) return;
		const code = encodeInviteCode(ghState.repoName, ghState.token);
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		inviteLink = `${origin}/invite?code=${code}`;
		inviteLinkCopied = false;
	}

	async function copyInviteLink() {
		try {
			await navigator.clipboard.writeText(inviteLink);
			inviteLinkCopied = true;
			setTimeout(() => { inviteLinkCopied = false; }, 2000);
		} catch {
			// Fallback: select the text
		}
	}
```

- [ ] **Step 2: Add template section**

Add this section immediately after the existing "Invite a Player" section (after line 484, after the closing `{/if}` of the Direct Invite block):

```svelte
		<!-- Generate Invite Link -->
		{#if $githubState.repoOwner && $githubState.repoName}
			<section class="section">
				<h2 class="section-title">Invite Link</h2>
				<p class="section-desc">
					Generate a link anyone can use to join your world. No GitHub account needed — they just pick a name and play.
				</p>
				{#if inviteLink}
					<div class="invite-link-display">
						<input
							class="field-input invite-link-field"
							type="text"
							readonly
							value={inviteLink}
							onclick={(e) => (e.target as HTMLInputElement).select()}
						/>
						<button class="btn btn-primary" onclick={copyInviteLink}>
							{inviteLinkCopied ? 'Copied!' : 'Copy'}
						</button>
					</div>
					<p class="section-hint">
						This link contains your repo access token. Share it only with people you trust.
					</p>
				{:else}
					<button class="btn btn-primary" onclick={generateInviteLink}>
						Generate Invite Link
					</button>
				{/if}
			</section>
		{/if}
```

- [ ] **Step 3: Add styles**

Add to the `<style>` block:

```css
	.invite-link-display {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.invite-link-field {
		flex: 1;
		font-size: 0.8rem;
		font-family: monospace;
		cursor: text;
	}

	.section-hint {
		font-size: 0.78rem;
		opacity: 0.5;
		font-style: italic;
	}
```

- [ ] **Step 4: Verify types compile**

Run: `eval "$(direnv export bash 2>/dev/null)" && npm run check`
Expected: No new type errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/connect/+page.svelte
git commit -m "feat: add Generate Invite Link section to connect page"
```

---

### Task 6: Create `/invite` redemption page

**Files:**
- Create: `src/routes/invite/+page.svelte`

- [ ] **Step 1: Create the invite page**

Create `src/routes/invite/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { githubState, saveGitHubState } from '$lib/stores/github';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { saveWorldState, saveWorldBlocks } from '$lib/engine/world-loader';
	import { decodeInviteCode } from '$lib/invites/invite-code';
	import { validateToken, validateRepo } from '$lib/git/github-client';
	import { fetchRepoFiles, buildWorldBlocksFromFiles, buildWorldStateFromFiles, cacheFiles } from '$lib/git/yaml-loader';
	import { onMount } from 'svelte';

	let status = $state<'input' | 'validating' | 'name-entry' | 'joining' | 'error'>('input');
	let errorMessage = $state('');
	let codeInput = $state('');
	let displayName = $state('');

	let decodedRepo = $state('');
	let decodedToken = $state('');
	let discoveredOwner = $state('');

	onMount(() => {
		const codeParam = page.url.searchParams.get('code');
		if (codeParam) {
			codeInput = codeParam;
			validateCode(codeParam);
		}
	});

	async function validateCode(code: string) {
		status = 'validating';
		errorMessage = '';

		const decoded = decodeInviteCode(code);
		if (!decoded) {
			status = 'error';
			errorMessage = "This invite link doesn't look right. Ask the world owner for a new one.";
			return;
		}

		decodedRepo = decoded.repo;
		decodedToken = decoded.token;

		// Discover repo owner via token
		const tokenResult = await validateToken(decodedToken);
		if (!tokenResult.valid) {
			status = 'error';
			errorMessage = 'This invite has expired or the token was revoked. Ask the world owner for a new link.';
			return;
		}

		// Try token owner's repo first
		const repoResult = await validateRepo(decodedToken, tokenResult.username, decodedRepo);
		if (repoResult.valid) {
			discoveredOwner = tokenResult.username;
		} else {
			status = 'error';
			errorMessage = `Couldn't find the world repo "${decodedRepo}". It may have been renamed or deleted.`;
			return;
		}

		if (!repoResult.canWrite) {
			status = 'error';
			errorMessage = 'This invite token does not have write access to the repo. Ask the world owner to check the token permissions.';
			return;
		}

		status = 'name-entry';
	}

	function handlePasteCode() {
		if (!codeInput.trim()) return;
		validateCode(codeInput.trim());
	}

	async function handleJoin() {
		if (!displayName.trim()) return;
		status = 'joining';

		try {
			const files = await fetchRepoFiles(decodedToken, discoveredOwner, decodedRepo);
			cacheFiles(files);
			const blocks = buildWorldBlocksFromFiles(files);
			const state = buildWorldStateFromFiles(files, blocks);

			worldBlocks.set(blocks);
			worldState.set(state);
			saveWorldBlocks(blocks);
			saveWorldState(state);

			const newGhState = {
				isAuthenticated: true,
				username: '',
				displayName: displayName.trim(),
				token: decodedToken,
				authMethod: 'invite-code' as const,
				repoOwner: discoveredOwner,
				repoName: decodedRepo,
				isConnected: true,
				syncStatus: 'idle' as const,
				pendingChanges: []
			};
			githubState.set(newGhState);
			saveGitHubState(newGhState);

			goto(`${base}/journal/setup`);
		} catch (err: any) {
			status = 'error';
			errorMessage = `Couldn't load the world: ${err.message}`;
		}
	}
</script>

<div class="invite-page">
	<div class="invite-inner">
		<h1 class="invite-title">Join a World</h1>

		{#if status === 'input'}
			<p class="invite-desc">Paste your invite code below to join a friend's world.</p>
			<div class="code-input-row">
				<input
					class="field-input"
					type="text"
					placeholder="Paste invite code"
					bind:value={codeInput}
					onkeydown={(e) => { if (e.key === 'Enter') handlePasteCode(); }}
				/>
				<button class="btn btn-primary" onclick={handlePasteCode} disabled={!codeInput.trim()}>
					Join
				</button>
			</div>

		{:else if status === 'validating'}
			<p class="invite-desc">Checking invite...</p>

		{:else if status === 'name-entry'}
			<p class="invite-desc">
				You've been invited to play in <strong>{decodedRepo}</strong>.
			</p>
			<label class="name-label">
				What should we call you?
				<input
					class="field-input name-input"
					type="text"
					placeholder="Your name"
					bind:value={displayName}
					onkeydown={(e) => { if (e.key === 'Enter') handleJoin(); }}
				/>
			</label>
			<button class="btn btn-primary" onclick={handleJoin} disabled={!displayName.trim()}>
				Start Playing
			</button>

		{:else if status === 'joining'}
			<p class="invite-desc">Loading world...</p>

		{:else if status === 'error'}
			<p class="error-msg">{errorMessage}</p>
			<button class="btn btn-secondary" onclick={() => { status = 'input'; errorMessage = ''; }}>
				Try Again
			</button>
		{/if}

		<div class="footer-links">
			<a href="{base}/login" class="footer-link">Login with GitHub instead</a>
		</div>
	</div>
</div>

<style>
	.invite-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--session-end-bg, #1a1a16);
		color: var(--session-end-text, #c8c4b8);
		font-family: var(--journal-font, Georgia, serif);
		padding: 1rem;
	}

	.invite-inner {
		max-width: 440px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.invite-title {
		font-size: 1.6rem;
		font-weight: normal;
		color: var(--journal-accent, #d4b96a);
		text-align: center;
	}

	.invite-desc {
		font-size: 0.95rem;
		line-height: 1.6;
		opacity: 0.8;
		text-align: center;
	}

	.code-input-row {
		display: flex;
		gap: 0.5rem;
	}

	.field-input {
		flex: 1;
		padding: 0.6rem 0.85rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(74, 74, 58, 0.6);
		border-radius: 4px;
		color: var(--session-end-text, #c8c4b8);
		font-family: inherit;
		font-size: 0.9rem;
	}

	.field-input:focus {
		outline: none;
		border-color: var(--journal-accent, #d4b96a);
	}

	.name-label {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.9rem;
		opacity: 0.7;
	}

	.name-input {
		font-size: 1.1rem;
		padding: 0.75rem 1rem;
		text-align: center;
	}

	.btn {
		padding: 0.6rem 1.25rem;
		border-radius: 4px;
		cursor: pointer;
		font-family: inherit;
		font-size: 0.9rem;
		border: 1px solid transparent;
		transition: background 0.15s, border-color 0.15s;
	}

	.btn-primary {
		background: rgba(139, 105, 20, 0.2);
		border-color: rgba(139, 105, 20, 0.5);
		color: var(--journal-accent, #d4b96a);
	}

	.btn-primary:hover:not(:disabled) {
		background: rgba(139, 105, 20, 0.35);
		border-color: var(--journal-accent, #d4b96a);
	}

	.btn-primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(74, 74, 58, 0.6);
		color: var(--session-end-text, #c8c4b8);
	}

	.btn-secondary:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.error-msg {
		color: #e09090;
		font-size: 0.9rem;
		text-align: center;
		padding: 0.75rem;
		border: 1px solid rgba(180, 60, 60, 0.3);
		border-radius: 4px;
		background: rgba(180, 60, 60, 0.08);
	}

	.footer-links {
		text-align: center;
		margin-top: 1rem;
	}

	.footer-link {
		color: var(--session-end-text, #c8c4b8);
		opacity: 0.5;
		font-size: 0.82rem;
		text-decoration: none;
	}

	.footer-link:hover {
		opacity: 1;
	}
</style>
```

- [ ] **Step 2: Verify types compile**

Run: `eval "$(direnv export bash 2>/dev/null)" && npm run check`
Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/invite/+page.svelte
git commit -m "feat: add /invite redemption page"
```

---

### Task 7: Add "Have an invite link?" to login page

**Files:**
- Modify: `src/routes/login/+page.svelte:155-157`

- [ ] **Step 1: Add invite link to footer**

In `src/routes/login/+page.svelte`, find the footer links section (line 155-157):

```svelte
		<div class="footer-links">
			<a href="{base}/?offline=true" class="footer-link">Play Offline</a>
		</div>
```

Replace with:

```svelte
		<div class="footer-links">
			<a href="{base}/invite" class="footer-link">Have an invite link?</a>
			<a href="{base}/?offline=true" class="footer-link">Play Offline</a>
		</div>
```

- [ ] **Step 2: Verify types compile**

Run: `eval "$(direnv export bash 2>/dev/null)" && npm run check`
Expected: No new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/login/+page.svelte
git commit -m "feat: add invite link to login page"
```

---

### Task 8: Manual browser testing

- [ ] **Step 1: Start dev server**

Run: `eval "$(direnv export bash 2>/dev/null)" && npm run dev`

- [ ] **Step 2: Test owner flow — generate invite link**

1. Login with a PAT or OAuth
2. Navigate to `/connect`
3. Click "Generate Invite Link"
4. Verify a full URL is displayed with `?code=` parameter
5. Click "Copy" — verify clipboard contains the URL

- [ ] **Step 3: Test player flow — redeem invite link**

1. Open the copied URL in a private/incognito window (or clear localStorage first)
2. Verify the page shows "You've been invited to play in **[repo name]**"
3. Enter a display name, click "Start Playing"
4. Verify the world loads and you reach `/journal/setup`

- [ ] **Step 4: Test player flow — manual code entry**

1. Navigate to `/invite` directly (no query param)
2. Verify paste field is shown
3. Paste just the code portion (not the full URL)
4. Verify validation and name entry work

- [ ] **Step 5: Test commit authoring**

1. As the invite-code player, play through a session and reach session-end
2. Click "Save & Menu" or "Forward in Time"
3. Check the GitHub repo — verify the commit shows the display name as author, not the PAT owner's username

- [ ] **Step 6: Test error cases**

1. Navigate to `/invite?code=garbage` — verify "This invite link doesn't look right" error
2. Navigate to `/invite?code=` with a valid base64 but revoked token — verify "expired or revoked" error

- [ ] **Step 7: Test login page link**

1. Navigate to `/login`
2. Verify "Have an invite link?" appears in footer and links to `/invite`

- [ ] **Step 8: Run full test suite**

Run: `eval "$(direnv export bash 2>/dev/null)" && npm test`
Expected: All tests pass.

- [ ] **Step 9: Commit any fixes**

```bash
git add -u
git commit -m "fix: invite code testing fixes"
```
