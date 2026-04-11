# GitHub Auth Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single "paste a classic PAT with `repo` scope" login flow with two parallel, well-scoped auth paths: an OAuth path (via Cloudflare Worker + CYOAGame GitHub App) for casual users, and a fine-grained PAT wizard for security-conscious users.

**Architecture:** Single source of truth for auth in `githubState` with an `authMethod` field. A thin `handleRequest` wrapper around runtime Octokit calls converts 401s into an `AuthExpiredError` that clears the session and bounces the user to `/login`. A new `/login/pat-wizard` route walks PAT users through forking and token creation. Login-time validators (`validateToken`, `validateRepo`) stay outside the wrapper so a bad candidate token doesn't wipe an existing valid session.

**Tech Stack:** SvelteKit 2 (static adapter), Svelte 5 (runes), TypeScript, Vitest, Octokit, Cloudflare Workers (for OAuth token exchange).

**Spec:** See `docs/superpowers/specs/2026-04-11-github-auth-redesign.md` for background, design rationale, and non-goals.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/git/auth-errors.ts` | `AuthExpiredError` class — runtime signal that a session is dead |
| `src/routes/login/pat-wizard/wizard-state.ts` | Pure state machine for the PAT wizard (testable in isolation) |
| `src/routes/login/pat-wizard/+page.svelte` | Thin UI wrapper around the state machine |
| `tools/wrangler.toml` | Cloudflare Worker config for `oauth-worker.js` |
| `tools/README.md` | GitHub OAuth App registration + Worker deployment instructions |
| `.env.example` | Documents `PUBLIC_GITHUB_CLIENT_ID` and `PUBLIC_OAUTH_WORKER_URL` |
| `tests/git/auth-errors.test.ts` | Shape tests for `AuthExpiredError` |
| `tests/stores/github.test.ts` | `saveGitHubState` round-trip, `clearAuth`, migrations |
| `tests/stores/player.test.ts` | Legacy token migration |
| `tests/routes/pat-wizard-state.test.ts` | State machine transitions + sessionStorage round-trip |

### Modified files

| Path | Change |
|---|---|
| `src/lib/stores/github.ts` | Add `authMethod`, stop stripping token, add `clearAuth()` |
| `src/lib/stores/player.ts` | Remove `githubToken`/`githubUsername`, add legacy migration |
| `src/lib/git/github-client.ts` | Add `handleRequest`, wrap runtime API calls, leave validators alone |
| `src/lib/git/repo-writer.ts` | Wrap Octokit calls with `handleRequest`, preserve 409 logic |
| `tools/oauth-worker.js` | Round-trip `state` param, append `method=oauth` to redirect |
| `src/routes/login/+page.svelte` | Wire OAuth button, add error banner, replace PAT input with wizard link |
| `src/routes/connect/+page.svelte` | Branch Create World on `authMethod`, use `clearAuth` in logout |
| `tests/git/github-client.test.ts` | Extend with `handleRequest` tests |

### Files untouched (but depended on)

`src/lib/git/yaml-loader.ts`, `src/routes/journal/*`, `src/lib/engine/*`, all world content files.

---

## Task 1: Create `AuthExpiredError`

**Files:**
- Create: `src/lib/git/auth-errors.ts`
- Test: `tests/git/auth-errors.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/git/auth-errors.test.ts
import { describe, it, expect } from 'vitest';
import { AuthExpiredError } from '../../src/lib/git/auth-errors';

describe('AuthExpiredError', () => {
	it('is an instance of Error', () => {
		const err = new AuthExpiredError();
		expect(err).toBeInstanceOf(Error);
	});

	it('has name "AuthExpiredError"', () => {
		const err = new AuthExpiredError();
		expect(err.name).toBe('AuthExpiredError');
	});

	it('has a default message', () => {
		const err = new AuthExpiredError();
		expect(err.message).toBe('GitHub session expired');
	});

	it('accepts a custom message', () => {
		const err = new AuthExpiredError('Token revoked');
		expect(err.message).toBe('Token revoked');
	});

	it('can be caught as a specific type', () => {
		try {
			throw new AuthExpiredError();
		} catch (err) {
			expect(err instanceof AuthExpiredError).toBe(true);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/git/auth-errors.test.ts`
Expected: FAIL — module `auth-errors` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/git/auth-errors.ts
export class AuthExpiredError extends Error {
	constructor(message: string = 'GitHub session expired') {
		super(message);
		this.name = 'AuthExpiredError';
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/git/auth-errors.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/auth-errors.ts tests/git/auth-errors.test.ts
git commit -m "feat(auth): add AuthExpiredError for session expiry signaling"
```

---

## Task 2: Extend `githubState` with `authMethod` and `clearAuth`

**Files:**
- Modify: `src/lib/stores/github.ts`
- Test: `tests/stores/github.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/stores/github.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	githubState,
	saveGitHubState,
	loadGitHubState,
	clearAuth
} from '../../src/lib/stores/github';

// Minimal localStorage shim for test environment
class MemoryStorage {
	private store = new Map<string, string>();
	getItem(k: string) { return this.store.get(k) ?? null; }
	setItem(k: string, v: string) { this.store.set(k, v); }
	removeItem(k: string) { this.store.delete(k); }
	clear() { this.store.clear(); }
	get length() { return this.store.size; }
	key(i: number) { return [...this.store.keys()][i] ?? null; }
}

beforeEach(() => {
	(globalThis as any).localStorage = new MemoryStorage();
	githubState.set({
		isAuthenticated: false,
		username: '',
		token: '',
		authMethod: null,
		repoOwner: '',
		repoName: '',
		isConnected: false,
		syncStatus: 'idle',
		pendingChanges: []
	});
});

describe('saveGitHubState', () => {
	it('persists the full state including the token', () => {
		saveGitHubState({
			isAuthenticated: true,
			username: 'alice',
			token: 'ghp_secret',
			authMethod: 'oauth',
			repoOwner: 'alice',
			repoName: 'world',
			isConnected: true,
			syncStatus: 'synced',
			pendingChanges: []
		});
		const loaded = loadGitHubState();
		expect(loaded.token).toBe('ghp_secret');
		expect(loaded.authMethod).toBe('oauth');
		expect(loaded.username).toBe('alice');
	});
});

describe('clearAuth', () => {
	it('wipes token, authMethod, username, isAuthenticated from the store', () => {
		githubState.set({
			isAuthenticated: true,
			username: 'alice',
			token: 'ghp_secret',
			authMethod: 'pat',
			repoOwner: 'alice',
			repoName: 'world',
			isConnected: true,
			syncStatus: 'synced',
			pendingChanges: []
		});
		clearAuth();
		const state = get(githubState);
		expect(state.token).toBe('');
		expect(state.authMethod).toBeNull();
		expect(state.username).toBe('');
		expect(state.isAuthenticated).toBe(false);
		expect(state.isConnected).toBe(false);
	});

	it('removes the persisted state from localStorage', () => {
		saveGitHubState({
			isAuthenticated: true,
			username: 'alice',
			token: 'ghp_secret',
			authMethod: 'pat',
			repoOwner: 'alice',
			repoName: 'world',
			isConnected: true,
			syncStatus: 'synced',
			pendingChanges: []
		});
		clearAuth();
		const raw = localStorage.getItem('journal-rpg-github-state');
		const parsed = raw ? JSON.parse(raw) : null;
		expect(parsed?.token ?? '').toBe('');
		expect(parsed?.authMethod ?? null).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/stores/github.test.ts`
Expected: FAIL — `authMethod` not in type, `clearAuth` not exported.

- [ ] **Step 3: Update the store file**

Replace the full contents of `src/lib/stores/github.ts`:

```typescript
import { writable, derived, get } from 'svelte/store';

export type AuthMethod = 'oauth' | 'pat' | null;

export interface GitHubState {
	isAuthenticated: boolean;
	username: string;
	token: string;
	authMethod: AuthMethod;
	repoOwner: string;
	repoName: string;
	isConnected: boolean;
	syncStatus: 'idle' | 'syncing' | 'synced' | 'pending' | 'error';
	syncError?: string;
	pendingChanges: PendingChange[];
}

export interface PendingChange {
	path: string;
	content: string;
	message: string;
	timestamp: number;
}

const DEFAULT_STATE: GitHubState = {
	isAuthenticated: false,
	username: '',
	token: '',
	authMethod: null,
	repoOwner: '',
	repoName: '',
	isConnected: false,
	syncStatus: 'idle',
	pendingChanges: []
};

export const githubState = writable<GitHubState>(DEFAULT_STATE);

export const isOnline = derived(githubState, ($state) =>
	$state.isAuthenticated && $state.isConnected
);

const GH_STATE_KEY = 'journal-rpg-github-state';

export function saveGitHubState(state: GitHubState): void {
	if (typeof localStorage === 'undefined') return;
	// Persist the full state including the token. Previous versions stripped
	// the token for "safety" but the real token still lived in playerPrefs —
	// the split was pure footgun.
	localStorage.setItem(GH_STATE_KEY, JSON.stringify(state));
}

export function loadGitHubState(): Partial<GitHubState> {
	if (typeof localStorage === 'undefined') return {};
	const raw = localStorage.getItem(GH_STATE_KEY);
	if (!raw) return {};
	try {
		return JSON.parse(raw) as Partial<GitHubState>;
	} catch {
		return {};
	}
}

/**
 * Wipe all auth fields from both the in-memory store and localStorage.
 * Called on logout and on 401 during a runtime API call.
 */
export function clearAuth(): void {
	githubState.update((s) => ({
		...s,
		isAuthenticated: false,
		username: '',
		token: '',
		authMethod: null,
		isConnected: false
	}));
	if (typeof localStorage !== 'undefined') {
		const current = get(githubState);
		localStorage.setItem(GH_STATE_KEY, JSON.stringify(current));
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/stores/github.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Typecheck**

Run: `npm run check`
Expected: no new errors. (`authMethod: null` satisfies the updated type everywhere.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/github.ts tests/stores/github.test.ts
git commit -m "feat(auth): add authMethod + clearAuth to github store"
```

---

## Task 3: Remove token from `playerPrefs` and add legacy migration

**Files:**
- Modify: `src/lib/stores/player.ts`
- Test: `tests/stores/player.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/stores/player.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlayerPrefs, savePlayerPrefs } from '../../src/lib/stores/player';
import { loadGitHubState } from '../../src/lib/stores/github';

class MemoryStorage {
	private store = new Map<string, string>();
	getItem(k: string) { return this.store.get(k) ?? null; }
	setItem(k: string, v: string) { this.store.set(k, v); }
	removeItem(k: string) { this.store.delete(k); }
	clear() { this.store.clear(); }
	get length() { return this.store.size; }
	key(i: number) { return [...this.store.keys()][i] ?? null; }
}

beforeEach(() => {
	(globalThis as any).localStorage = new MemoryStorage();
});

describe('loadPlayerPrefs legacy migration', () => {
	it('migrates githubToken from legacy prefs to githubState', () => {
		// Seed legacy prefs shape
		localStorage.setItem('journal-rpg-player-prefs', JSON.stringify({
			dayTypePreferences: [],
			llmSetting: 'none',
			githubToken: 'ghp_legacy',
			githubUsername: 'alice',
			repoOwner: 'alice',
			repoName: 'world'
		}));
		const prefs = loadPlayerPrefs();
		// Token should no longer be in prefs
		expect((prefs as any).githubToken).toBeUndefined();
		expect((prefs as any).githubUsername).toBeUndefined();
		// Non-auth fields preserved
		expect(prefs.repoOwner).toBe('alice');
		expect(prefs.repoName).toBe('world');
		// Token now lives in githubState
		const ghState = loadGitHubState();
		expect(ghState.token).toBe('ghp_legacy');
		expect(ghState.username).toBe('alice');
		expect(ghState.authMethod).toBeNull();
	});

	it('is a no-op for fresh installs', () => {
		const prefs = loadPlayerPrefs();
		expect(prefs.dayTypePreferences).toEqual([]);
		expect(prefs.llmSetting).toBe('none');
		expect((prefs as any).githubToken).toBeUndefined();
	});

	it('is a no-op for already-migrated prefs', () => {
		localStorage.setItem('journal-rpg-player-prefs', JSON.stringify({
			dayTypePreferences: ['adventure'],
			llmSetting: 'claude',
			repoOwner: 'bob',
			repoName: 'mine'
		}));
		const prefs = loadPlayerPrefs();
		expect(prefs.dayTypePreferences).toEqual(['adventure']);
		expect(prefs.llmSetting).toBe('claude');
		expect(prefs.repoOwner).toBe('bob');
		const ghState = loadGitHubState();
		// No token in githubState because there was nothing to migrate
		expect(ghState.token ?? '').toBe('');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/stores/player.test.ts`
Expected: FAIL — `githubToken` still exists on the type, no migration happens.

- [ ] **Step 3: Update `player.ts`**

Replace the full contents of `src/lib/stores/player.ts`:

```typescript
import { writable } from 'svelte/store';
import { saveGitHubState, loadGitHubState } from './github';

export interface PlayerPrefs {
	dayTypePreferences: string[];
	llmSetting: 'none' | 'local' | 'claude';
	llmEndpoint?: string;
	llmModel?: string;
	llmApiKey?: string;
	repoOwner?: string;
	repoName?: string;
}

const DEFAULT_PREFS: PlayerPrefs = {
	dayTypePreferences: [],
	llmSetting: 'none'
};

const PREFS_KEY = 'journal-rpg-player-prefs';

export const playerPrefs = writable<PlayerPrefs>(DEFAULT_PREFS);

interface LegacyPrefs extends PlayerPrefs {
	githubToken?: string;
	githubUsername?: string;
}

export function loadPlayerPrefs(): PlayerPrefs {
	if (typeof localStorage === 'undefined') return DEFAULT_PREFS;
	const raw = localStorage.getItem(PREFS_KEY);
	if (!raw) return DEFAULT_PREFS;
	let parsed: LegacyPrefs;
	try {
		parsed = JSON.parse(raw) as LegacyPrefs;
	} catch {
		return DEFAULT_PREFS;
	}

	// One-time migration: if legacy prefs have a token, move it to githubState
	// and strip it from prefs. authMethod is null so the next 401 will surface
	// the reconnect banner asking the user to pick a method explicitly.
	if (parsed.githubToken || parsed.githubUsername) {
		const existingGh = loadGitHubState();
		saveGitHubState({
			isAuthenticated: true,
			username: parsed.githubUsername ?? '',
			token: parsed.githubToken ?? '',
			authMethod: null,
			repoOwner: existingGh.repoOwner ?? parsed.repoOwner ?? '',
			repoName: existingGh.repoName ?? parsed.repoName ?? '',
			isConnected: Boolean(existingGh.isConnected),
			syncStatus: existingGh.syncStatus ?? 'idle',
			pendingChanges: existingGh.pendingChanges ?? []
		});
		const { githubToken: _t, githubUsername: _u, ...stripped } = parsed;
		localStorage.setItem(PREFS_KEY, JSON.stringify(stripped));
		return stripped as PlayerPrefs;
	}

	return parsed;
}

export function savePlayerPrefs(prefs: PlayerPrefs): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
```

- [ ] **Step 4: Run the new test**

Run: `npm test -- tests/stores/player.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Run the full test suite to catch any callers of the removed fields**

Run: `npm test`
Expected: all tests pass. If any fail referencing `prefs.githubToken`, those are call sites that will be updated in later tasks — note them but do not patch them yet unless they fail compile. Failing tests here are OK to carry forward since Tasks 13 and 14 will update the login/connect pages.

**Note:** `src/routes/login/+page.svelte`, `src/routes/connect/+page.svelte`, and `src/routes/settings/+page.svelte` reference `playerPrefs.githubToken`. Those will break `npm run check` until Tasks 13, 14 update them. For this commit, run `npm run check` and note the errors — they should be in login, connect, and settings only. Do NOT patch them in this task.

- [ ] **Step 6: Typecheck and document expected breakage**

Run: `npm run check`
Expected: errors in:
- `src/routes/login/+page.svelte` (references `prefs.githubToken`) — fixed in Task 13
- `src/routes/connect/+page.svelte` (references `prefs.githubToken`) — fixed in Task 14
- `src/routes/settings/+page.svelte` (references `prefs.githubToken`) — needs a small patch in Task 14

If other files show errors, investigate before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/stores/player.ts tests/stores/player.test.ts
git commit -m "feat(auth): move github token out of playerPrefs, add legacy migration"
```

---

## Task 4: Add `handleRequest` wrapper in `github-client.ts`

**Files:**
- Modify: `src/lib/git/github-client.ts`
- Test: `tests/git/github-client.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/git/github-client.test.ts`:

```typescript
import { handleRequest } from '../../src/lib/git/github-client';
import { AuthExpiredError } from '../../src/lib/git/auth-errors';
import { githubState } from '../../src/lib/stores/github';
import { get } from 'svelte/store';
import { beforeEach } from 'vitest';

class MemoryStorage {
	private store = new Map<string, string>();
	getItem(k: string) { return this.store.get(k) ?? null; }
	setItem(k: string, v: string) { this.store.set(k, v); }
	removeItem(k: string) { this.store.delete(k); }
	clear() { this.store.clear(); }
	get length() { return this.store.size; }
	key(i: number) { return [...this.store.keys()][i] ?? null; }
}

describe('handleRequest', () => {
	beforeEach(() => {
		(globalThis as any).localStorage = new MemoryStorage();
		githubState.set({
			isAuthenticated: true,
			username: 'alice',
			token: 'ghp_valid',
			authMethod: 'pat',
			repoOwner: 'alice',
			repoName: 'world',
			isConnected: true,
			syncStatus: 'synced',
			pendingChanges: []
		});
	});

	it('returns the function result on success', async () => {
		const result = await handleRequest(async () => 42);
		expect(result).toBe(42);
	});

	it('throws AuthExpiredError and clears auth on 401', async () => {
		const fakeErr = Object.assign(new Error('Bad credentials'), { status: 401 });
		await expect(
			handleRequest(async () => { throw fakeErr; })
		).rejects.toBeInstanceOf(AuthExpiredError);
		const state = get(githubState);
		expect(state.token).toBe('');
		expect(state.authMethod).toBeNull();
	});

	it('passes through 403 without clearing auth', async () => {
		const fakeErr = Object.assign(new Error('Forbidden'), { status: 403 });
		await expect(
			handleRequest(async () => { throw fakeErr; })
		).rejects.toBe(fakeErr);
		const state = get(githubState);
		expect(state.token).toBe('ghp_valid'); // untouched
	});

	it('passes through 404 without clearing auth', async () => {
		const fakeErr = Object.assign(new Error('Not found'), { status: 404 });
		await expect(
			handleRequest(async () => { throw fakeErr; })
		).rejects.toBe(fakeErr);
		const state = get(githubState);
		expect(state.token).toBe('ghp_valid');
	});

	it('handles Octokit-style response.status shape on 401', async () => {
		const fakeErr = Object.assign(new Error('Unauthorized'), {
			response: { status: 401 }
		});
		await expect(
			handleRequest(async () => { throw fakeErr; })
		).rejects.toBeInstanceOf(AuthExpiredError);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/git/github-client.test.ts`
Expected: FAIL — `handleRequest` not exported.

- [ ] **Step 3: Add `handleRequest` to `github-client.ts`**

Add to the top of `src/lib/git/github-client.ts`, below the existing `import { Octokit } from 'octokit';` line:

```typescript
import { AuthExpiredError } from './auth-errors';
import { clearAuth } from '../stores/github';

/**
 * Wrap a runtime Octokit call so that 401s are promoted to AuthExpiredError
 * and the in-memory + persisted session is cleared. Non-401 errors pass
 * through unchanged. Use this for calls made AFTER a valid session exists,
 * NOT for login-time validators like validateToken / validateRepo.
 */
export async function handleRequest<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		const status =
			(err as { status?: number })?.status ??
			(err as { response?: { status?: number } })?.response?.status;
		if (status === 401) {
			clearAuth();
			throw new AuthExpiredError();
		}
		throw err;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/git/github-client.test.ts`
Expected: all tests pass (original `parseRepoUrl` tests + 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/github-client.ts tests/git/github-client.test.ts
git commit -m "feat(auth): add handleRequest wrapper to promote 401 to AuthExpiredError"
```

---

## Task 5: Wrap runtime API calls in `github-client.ts` (leave validators alone)

**Files:**
- Modify: `src/lib/git/github-client.ts`
- Test: `tests/git/github-client.test.ts` (extend)

**Goal:** `forkRepo`, `listUserRepos`, `checkForkStatus`, `syncFork` go through `handleRequest`. `validateToken` and `validateRepo` do NOT — they continue returning friendly shapes on 401 so the PAT wizard can validate candidate tokens without touching the session.

- [ ] **Step 1: Write a regression test that validators don't clobber an existing session**

Append to `tests/git/github-client.test.ts`:

```typescript
import { validateToken, validateRepo } from '../../src/lib/git/github-client';

describe('validators do not clear auth on 401', () => {
	beforeEach(() => {
		(globalThis as any).localStorage = new MemoryStorage();
		githubState.set({
			isAuthenticated: true,
			username: 'alice',
			token: 'ghp_existing',
			authMethod: 'oauth',
			repoOwner: 'alice',
			repoName: 'world',
			isConnected: true,
			syncStatus: 'synced',
			pendingChanges: []
		});
	});

	// These call real Octokit with a bogus token — network-free because
	// octokit throws on the first request without network access in tests,
	// but the important thing is our code path: catch, return friendly
	// shape, do not call clearAuth.
	it('validateToken with a bogus token returns {valid:false} and leaves the session alone', async () => {
		const result = await validateToken('ghp_definitely_not_real_xxxx');
		expect(result.valid).toBe(false);
		expect(get(githubState).token).toBe('ghp_existing');
		expect(get(githubState).authMethod).toBe('oauth');
	});

	it('validateRepo with a bogus token returns {valid:false} and leaves the session alone', async () => {
		const result = await validateRepo('ghp_definitely_not_real_xxxx', 'nobody', 'nothing');
		expect(result.valid).toBe(false);
		expect(get(githubState).token).toBe('ghp_existing');
	});
});
```

- [ ] **Step 2: Run test**

Run: `npm test -- tests/git/github-client.test.ts`
Expected: PASS — the current validators already return `{ valid: false }` on any error, and they don't call `clearAuth`. This test codifies that behavior so future refactors don't break it.

- [ ] **Step 3: Wrap runtime API calls**

In `src/lib/git/github-client.ts`, update each runtime function to go through `handleRequest`. Full replacements:

```typescript
export async function forkRepo(token: string, templateOwner: string, templateRepo: string): Promise<{ owner: string; repo: string } | null> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const { data } = await octokit.rest.repos.createFork({ owner: templateOwner, repo: templateRepo });
			return { owner: data.owner.login, repo: data.name };
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return null;
	}
}

export async function listUserRepos(token: string): Promise<Array<{ owner: string; repo: string; description: string }>> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const { data } = await octokit.rest.repos.listForAuthenticatedUser({ sort: 'updated', per_page: 20 });
			return data.map(r => ({ owner: r.owner.login, repo: r.name, description: r.description ?? '' }));
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return [];
	}
}

export async function checkForkStatus(
	token: string,
	owner: string,
	repo: string
): Promise<{ isFork: boolean; behind: boolean; behindBy: number; parentOwner: string; parentRepo: string } | null> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
			if (!repoData.parent) return null;
			const parentOwner = repoData.parent.owner.login;
			const parentRepo = repoData.parent.name;
			try {
				const { data: comparison } = await octokit.rest.repos.compareCommits({
					owner: parentOwner,
					repo: parentRepo,
					base: `${owner}:main`,
					head: `${parentOwner}:main`
				});
				return {
					isFork: true,
					behind: comparison.ahead_by > 0,
					behindBy: comparison.ahead_by,
					parentOwner,
					parentRepo
				};
			} catch {
				return { isFork: true, behind: true, behindBy: 0, parentOwner, parentRepo };
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return null;
	}
}

export async function syncFork(
	token: string,
	owner: string,
	repo: string
): Promise<{ success: boolean; error?: string }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			try {
				await octokit.rest.repos.mergeUpstream({ owner, repo, branch: 'main' });
				return { success: true };
			} catch (err: any) {
				try {
					await octokit.rest.repos.mergeUpstream({ owner, repo, branch: 'master' });
					return { success: true };
				} catch (err2: any) {
					return { success: false, error: err2.message ?? err.message ?? 'Sync failed' };
				}
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Sync failed' };
	}
}
```

Leave `validateToken`, `validateRepo`, `getOctokit`, and `parseRepoUrl` untouched.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/git/github-client.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/git/github-client.ts tests/git/github-client.test.ts
git commit -m "feat(auth): route runtime github-client calls through handleRequest"
```

---

## Task 6: Wrap `repo-writer.ts` Octokit calls with `handleRequest`

**Files:**
- Modify: `src/lib/git/repo-writer.ts`
- Test: Existing `tests/git/repo-writer.test.ts` must still pass.

**Strategy:** `repo-writer.ts` has several functions that catch errors broadly and translate them to `{ success: false, error: … }`. We want 401s to propagate as `AuthExpiredError` (so callers can redirect to login) while preserving 409 merge-conflict handling in `syncBranchWithMain` and `mergeBranchToMain`.

- [ ] **Step 1: Add the import**

At the top of `src/lib/git/repo-writer.ts`:

```typescript
import { handleRequest } from './github-client';
import { AuthExpiredError } from './auth-errors';
```

- [ ] **Step 2: Update `commitFiles`**

Replace the `try { … } catch { return { success: false, … } }` block in `commitFiles` so that the inner Octokit calls go through `handleRequest`, and `AuthExpiredError` is rethrown while other errors still return the friendly shape:

```typescript
export async function commitFiles(
	token: string,
	owner: string,
	repo: string,
	files: Map<string, string>,
	message: string
): Promise<{ success: boolean; sha?: string; error?: string }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);

			const refInfo = await resolveRef(octokit, owner, repo);
			if (!refInfo) return { success: false, error: 'Could not find main or master branch' };

			const { data: commitData } = await octokit.rest.git.getCommit({
				owner, repo, commit_sha: refInfo.sha
			});
			const baseTreeSha = commitData.tree.sha;

			const treeEntries = await Promise.all(
				[...files.entries()].map(async ([path, content]) => {
					const { data: blob } = await octokit.rest.git.createBlob({
						owner, repo, content, encoding: 'utf-8'
					});
					return {
						path,
						mode: '100644' as const,
						type: 'blob' as const,
						sha: blob.sha
					};
				})
			);

			const { data: newTree } = await octokit.rest.git.createTree({
				owner, repo,
				base_tree: baseTreeSha,
				tree: treeEntries
			});

			const { data: newCommit } = await octokit.rest.git.createCommit({
				owner, repo,
				message,
				tree: newTree.sha,
				parents: [refInfo.sha]
			});

			await octokit.rest.git.updateRef({
				owner, repo,
				ref: refInfo.ref,
				sha: newCommit.sha
			});

			return { success: true, sha: newCommit.sha };
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		const message = err instanceof Error ? err.message : 'Unknown error';
		return { success: false, error: message };
	}
}
```

- [ ] **Step 3: Update `ensureBranch`**

```typescript
export async function ensureBranch(
	token: string,
	owner: string,
	repo: string,
	characterId: string
): Promise<{ ref: string; sha: string } | null> {
	const octokit = getOctokit(token);
	const branchName = `journal/${characterId}`;
	const ref = `heads/${branchName}`;

	try {
		return await handleRequest(async () => {
			try {
				const { data } = await octokit.rest.git.getRef({ owner, repo, ref });
				return { ref, sha: data.object.sha };
			} catch {
				// fall through to create
			}
			const mainRef = await resolveRef(octokit, owner, repo);
			if (!mainRef) return null;
			try {
				const { data } = await octokit.rest.git.createRef({
					owner, repo,
					ref: `refs/${ref}`,
					sha: mainRef.sha
				});
				return { ref, sha: data.object.sha };
			} catch {
				return null;
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return null;
	}
}
```

- [ ] **Step 4: Update `commitToBranch`**

Same pattern as `commitFiles` — wrap the body in `handleRequest`, rethrow `AuthExpiredError`, return friendly shape on other errors. Full replacement:

```typescript
export async function commitToBranch(
	token: string,
	owner: string,
	repo: string,
	characterId: string,
	files: Map<string, string>,
	message: string
): Promise<{ success: boolean; sha?: string; error?: string }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);

			const branch = await ensureBranch(token, owner, repo, characterId);
			if (!branch) return { success: false, error: 'Could not create or find branch' };

			const { data: commitData } = await octokit.rest.git.getCommit({
				owner, repo, commit_sha: branch.sha
			});
			const baseTreeSha = commitData.tree.sha;

			const treeEntries = await Promise.all(
				[...files.entries()].map(async ([path, content]) => {
					const { data: blob } = await octokit.rest.git.createBlob({
						owner, repo, content, encoding: 'utf-8'
					});
					return { path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
				})
			);

			const { data: newTree } = await octokit.rest.git.createTree({
				owner, repo, base_tree: baseTreeSha, tree: treeEntries
			});

			const { data: newCommit } = await octokit.rest.git.createCommit({
				owner, repo, message, tree: newTree.sha, parents: [branch.sha]
			});

			await octokit.rest.git.updateRef({
				owner, repo, ref: branch.ref, sha: newCommit.sha
			});

			return { success: true, sha: newCommit.sha };
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		const msg = err instanceof Error ? err.message : 'Unknown error';
		return { success: false, error: msg };
	}
}
```

- [ ] **Step 5: Update `ensurePR`**

```typescript
export async function ensurePR(
	token: string,
	owner: string,
	repo: string,
	characterId: string,
	characterName: string
): Promise<{ prNumber: number } | null> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const branchName = `journal/${characterId}`;

			try {
				const { data: prs } = await octokit.rest.pulls.list({
					owner, repo, head: `${owner}:${branchName}`, state: 'open'
				});
				if (prs.length > 0) {
					return { prNumber: prs[0].number };
				}
			} catch {
				// continue to create
			}

			try {
				const { data: pr } = await octokit.rest.pulls.create({
					owner, repo,
					title: `Journal: ${characterName}`,
					body: `Ongoing journal entries for ${characterName}.\n\nThis PR is auto-managed by the Journal RPG game. Each commit represents one journal entry (one day).`,
					head: branchName,
					base: 'main'
				});
				return { prNumber: pr.number };
			} catch {
				try {
					const { data: pr } = await octokit.rest.pulls.create({
						owner, repo,
						title: `Journal: ${characterName}`,
						body: `Ongoing journal entries for ${characterName}.\n\nThis PR is auto-managed by the Journal RPG game. Each commit represents one journal entry (one day).`,
						head: branchName,
						base: 'master'
					});
					return { prNumber: pr.number };
				} catch {
					return null;
				}
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return null;
	}
}
```

- [ ] **Step 6: Update `syncBranchWithMain` (preserve 409 logic)**

```typescript
export async function syncBranchWithMain(
	token: string,
	owner: string,
	repo: string,
	characterId: string
): Promise<{ success: boolean; error?: string }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const branchName = `journal/${characterId}`;
			try {
				await octokit.rest.repos.merge({
					owner, repo, base: branchName, head: 'main',
					commit_message: `Sync ${branchName} with main`
				});
				return { success: true };
			} catch (err: any) {
				if (err.status === 409) return { success: true };
				try {
					await octokit.rest.repos.merge({
						owner, repo, base: branchName, head: 'master',
						commit_message: `Sync ${branchName} with master`
					});
					return { success: true };
				} catch (err2: any) {
					if (err2.status === 409) return { success: true };
					// 401 will escape this inner catch and be caught by handleRequest above
					if (err2.status === 401 || err.status === 401) throw err2;
					return { success: false, error: err2.message ?? 'Branch sync failed' };
				}
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Branch sync failed' };
	}
}
```

- [ ] **Step 7: Update `mergeBranchToMain` (preserve 409 logic)**

```typescript
export async function mergeBranchToMain(
	token: string,
	owner: string,
	repo: string,
	characterId: string
): Promise<{ success: boolean; error?: string }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const branchName = `journal/${characterId}`;
			try {
				await octokit.rest.repos.merge({
					owner, repo, base: 'main', head: branchName,
					commit_message: `Merge journal/${characterId}`
				});
				return { success: true };
			} catch (err: any) {
				try {
					await octokit.rest.repos.merge({
						owner, repo, base: 'master', head: branchName,
						commit_message: `Merge journal/${characterId}`
					});
					return { success: true };
				} catch (err2: any) {
					if (err2.status === 409 || err.status === 409) return { success: true };
					if (err2.status === 401 || err.status === 401) throw err2;
					return { success: false, error: err2.message ?? err.message ?? 'Merge failed' };
				}
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Merge failed' };
	}
}
```

- [ ] **Step 8: `saveWithPR` needs no changes** — it only calls the above functions, which now propagate `AuthExpiredError`. Its callers (journal pages) will need to catch that error in a later task; for now the propagation works.

- [ ] **Step 9: Run the existing repo-writer tests**

Run: `npm test -- tests/git/repo-writer.test.ts`
Expected: all tests pass (they don't exercise the network path).

- [ ] **Step 10: Typecheck**

Run: `npm run check`
Expected: same errors as Task 3 (login/connect/settings), plus no new ones.

- [ ] **Step 11: Commit**

```bash
git add src/lib/git/repo-writer.ts
git commit -m "feat(auth): propagate AuthExpiredError from repo-writer Octokit calls"
```

---

## Task 7: Update `oauth-worker.js` for state CSRF + method tagging

**Files:**
- Modify: `tools/oauth-worker.js`

- [ ] **Step 1: Replace the worker contents**

```javascript
// Minimal OAuth token exchange worker for GitHub
// Deploy to Cloudflare Workers.
// Set environment secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, APP_URL
// See tools/README.md for deployment instructions.

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname === '/callback') {
			const code = url.searchParams.get('code');
			const state = url.searchParams.get('state') ?? '';
			if (!code) {
				return new Response('Missing code parameter', { status: 400 });
			}
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
			const encodedState = encodeURIComponent(state);
			if (data.access_token) {
				const redirectUrl =
					`${env.APP_URL}/login?token=${data.access_token}` +
					`&method=oauth&state=${encodedState}`;
				return Response.redirect(redirectUrl, 302);
			}
			const errMsg = encodeURIComponent(data.error_description || 'Authentication failed');
			return Response.redirect(
				`${env.APP_URL}/login?error=${errMsg}&state=${encodedState}`,
				302
			);
		}
		return new Response('Not found', { status: 404 });
	}
};
```

- [ ] **Step 2: Syntax check (optional sanity)**

Run: `node --check tools/oauth-worker.js`
Expected: no output (syntactically valid).

- [ ] **Step 3: Commit**

```bash
git add tools/oauth-worker.js
git commit -m "feat(auth): oauth worker passes through state param and tags method"
```

---

## Task 8: Create `tools/wrangler.toml`

**Files:**
- Create: `tools/wrangler.toml`

- [ ] **Step 1: Write the file**

```toml
# Cloudflare Worker config for the GitHub OAuth token exchange.
# See tools/README.md for deployment instructions.

name = "cyoagame-oauth-worker"
main = "oauth-worker.js"
compatibility_date = "2026-04-11"

# Set via `wrangler secret put`:
#   GITHUB_CLIENT_ID      — from your GitHub OAuth App
#   GITHUB_CLIENT_SECRET  — from your GitHub OAuth App
#   APP_URL               — https://cyoagame.github.io/game
```

- [ ] **Step 2: Commit**

```bash
git add tools/wrangler.toml
git commit -m "feat(auth): add wrangler.toml for oauth worker"
```

---

## Task 9: Create `tools/README.md`

**Files:**
- Create: `tools/README.md`

- [ ] **Step 1: Write the file**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add tools/README.md
git commit -m "docs(auth): add oauth worker deployment instructions"
```

---

## Task 10: Create `.env.example`

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Check `.gitignore` already excludes `.env`**

Run: `grep -E '^\.env$|^\.env\b' .gitignore`
Expected: a line matching `.env`. If not, add `.env` to `.gitignore` before proceeding.

- [ ] **Step 2: Write the file**

```
# Copy to .env and fill in values. See tools/README.md for how to obtain these.
# Both must be PUBLIC_* because SvelteKit needs them in the browser bundle.
# The client_secret NEVER goes here — it lives only in Cloudflare Worker secrets.

PUBLIC_GITHUB_CLIENT_ID=your_oauth_app_client_id
PUBLIC_OAUTH_WORKER_URL=https://cyoagame-oauth-worker.your-subdomain.workers.dev
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "feat(auth): document oauth env vars in .env.example"
```

---

## Task 11: Build the PAT wizard state machine (pure logic, testable)

**Files:**
- Create: `src/routes/login/pat-wizard/wizard-state.ts`
- Test: `tests/routes/pat-wizard-state.test.ts` (new)

**Rationale:** The Svelte component in Task 12 will be a thin wrapper. All
transition logic, input validation, and sessionStorage round-tripping lives
here so it can be unit-tested without rendering the component.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/routes/pat-wizard-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
	initialWizardState,
	transition,
	saveWizardState,
	loadWizardState,
	clearWizardState,
	type WizardState
} from '../../src/routes/login/pat-wizard/wizard-state';

class MemoryStorage {
	private store = new Map<string, string>();
	getItem(k: string) { return this.store.get(k) ?? null; }
	setItem(k: string, v: string) { this.store.set(k, v); }
	removeItem(k: string) { this.store.delete(k); }
	clear() { this.store.clear(); }
	get length() { return this.store.size; }
	key(i: number) { return [...this.store.keys()][i] ?? null; }
}

beforeEach(() => {
	(globalThis as any).sessionStorage = new MemoryStorage();
});

describe('wizard state machine', () => {
	it('starts at the "choose" step', () => {
		const s = initialWizardState();
		expect(s.step).toBe('choose');
		expect(s.variant).toBeNull();
		expect(s.repoOwner).toBe('');
		expect(s.repoName).toBe('');
		expect(s.token).toBe('');
	});

	it('choose → create-step1 on pick-create', () => {
		const s = transition(initialWizardState(), { type: 'pick-create' });
		expect(s.step).toBe('create-step1');
		expect(s.variant).toBe('create');
	});

	it('choose → join-step1 on pick-join', () => {
		const s = transition(initialWizardState(), { type: 'pick-join' });
		expect(s.step).toBe('join-step1');
		expect(s.variant).toBe('join');
	});

	it('create-step1 advances to create-step2 with a valid repo', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'submit-repo', value: 'alice/ironhaven-fork' });
		expect(s.step).toBe('create-step2');
		expect(s.repoOwner).toBe('alice');
		expect(s.repoName).toBe('ironhaven-fork');
	});

	it('create-step1 rejects an unparseable repo and stays on step', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'submit-repo', value: 'not-a-repo' });
		expect(s.step).toBe('create-step1');
		expect(s.error).toContain('owner/repo');
	});

	it('join-step1 advances to join-step2 with a valid repo', () => {
		let s = transition(initialWizardState(), { type: 'pick-join' });
		s = transition(s, { type: 'submit-repo', value: 'CYOAGame/Public_Game' });
		expect(s.step).toBe('join-step2');
		expect(s.repoOwner).toBe('CYOAGame');
		expect(s.repoName).toBe('Public_Game');
	});

	it('step2 advances to "done" on submit-token', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'submit-repo', value: 'alice/fork' });
		s = transition(s, { type: 'submit-token', value: 'github_pat_AAA' });
		expect(s.step).toBe('done');
		expect(s.token).toBe('github_pat_AAA');
	});

	it('step2 rejects an empty token and stays on step', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'submit-repo', value: 'alice/fork' });
		s = transition(s, { type: 'submit-token', value: '   ' });
		expect(s.step).toBe('create-step2');
		expect(s.error).toContain('token');
	});

	it('back from create-step2 returns to create-step1 and preserves repo', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'submit-repo', value: 'alice/fork' });
		s = transition(s, { type: 'back' });
		expect(s.step).toBe('create-step1');
		expect(s.repoOwner).toBe('alice');
		expect(s.repoName).toBe('fork');
	});

	it('back from create-step1 returns to choose and clears variant', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'back' });
		expect(s.step).toBe('choose');
		expect(s.variant).toBeNull();
	});
});

describe('wizard state persistence', () => {
	it('saves and loads the full state', () => {
		const state: WizardState = {
			step: 'create-step2',
			variant: 'create',
			repoOwner: 'alice',
			repoName: 'fork',
			token: '',
			error: null
		};
		saveWizardState(state);
		const loaded = loadWizardState();
		expect(loaded).toEqual(state);
	});

	it('loadWizardState returns null when nothing is saved', () => {
		expect(loadWizardState()).toBeNull();
	});

	it('clearWizardState removes saved state', () => {
		saveWizardState({
			step: 'create-step1',
			variant: 'create',
			repoOwner: '',
			repoName: '',
			token: '',
			error: null
		});
		clearWizardState();
		expect(loadWizardState()).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/routes/pat-wizard-state.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the state machine**

```typescript
// src/routes/login/pat-wizard/wizard-state.ts
import { parseRepoUrl } from '$lib/git/github-client';

export type WizardStep =
	| 'choose'
	| 'create-step1'
	| 'create-step2'
	| 'join-step1'
	| 'join-step2'
	| 'done';

export type WizardVariant = 'create' | 'join' | null;

export interface WizardState {
	step: WizardStep;
	variant: WizardVariant;
	repoOwner: string;
	repoName: string;
	token: string;
	error: string | null;
}

export type WizardAction =
	| { type: 'pick-create' }
	| { type: 'pick-join' }
	| { type: 'submit-repo'; value: string }
	| { type: 'submit-token'; value: string }
	| { type: 'back' }
	| { type: 'reset' };

const STORAGE_KEY = 'journal-rpg-pat-wizard';

export function initialWizardState(): WizardState {
	return {
		step: 'choose',
		variant: null,
		repoOwner: '',
		repoName: '',
		token: '',
		error: null
	};
}

export function transition(state: WizardState, action: WizardAction): WizardState {
	const clearErr = { ...state, error: null };
	switch (action.type) {
		case 'pick-create':
			return { ...clearErr, step: 'create-step1', variant: 'create' };
		case 'pick-join':
			return { ...clearErr, step: 'join-step1', variant: 'join' };
		case 'submit-repo': {
			const parsed = parseRepoUrl(action.value);
			if (!parsed) {
				return {
					...state,
					error: 'Could not parse owner/repo. Try "owner/repo" or a full GitHub URL.'
				};
			}
			const nextStep: WizardStep =
				state.variant === 'create' ? 'create-step2' : 'join-step2';
			return {
				...clearErr,
				step: nextStep,
				repoOwner: parsed.owner,
				repoName: parsed.repo
			};
		}
		case 'submit-token': {
			const trimmed = action.value.trim();
			if (!trimmed) {
				return { ...state, error: 'Please paste a token.' };
			}
			return { ...clearErr, step: 'done', token: trimmed };
		}
		case 'back':
			if (state.step === 'create-step2') return { ...clearErr, step: 'create-step1' };
			if (state.step === 'join-step2') return { ...clearErr, step: 'join-step1' };
			if (state.step === 'create-step1' || state.step === 'join-step1') {
				return initialWizardState();
			}
			return state;
		case 'reset':
			return initialWizardState();
	}
}

export function saveWizardState(state: WizardState): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadWizardState(): WizardState | null {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as WizardState;
	} catch {
		return null;
	}
}

export function clearWizardState(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(STORAGE_KEY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/routes/pat-wizard-state.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/login/pat-wizard/wizard-state.ts tests/routes/pat-wizard-state.test.ts
git commit -m "feat(auth): add PAT wizard state machine"
```

---

## Task 12: Build the PAT wizard Svelte page

**Files:**
- Create: `src/routes/login/pat-wizard/+page.svelte`

**Strategy:** Import the state machine, render one panel per step, route every user action through `transition`. Persist `$state` to sessionStorage on every change, hydrate from sessionStorage on mount.

- [ ] **Step 1: Write the page**

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { validateToken, validateRepo } from '$lib/git/github-client';
	import { githubState, saveGitHubState } from '$lib/stores/github';
	import {
		initialWizardState,
		transition,
		saveWizardState,
		loadWizardState,
		clearWizardState,
		type WizardState
	} from './wizard-state';

	let state = $state<WizardState>(initialWizardState());
	let validating = $state(false);
	let tokenInput = $state('');
	let repoInput = $state('');

	onMount(() => {
		const restored = loadWizardState();
		if (restored) state = restored;
	});

	$effect(() => {
		saveWizardState(state);
	});

	function act(action: Parameters<typeof transition>[1]) {
		state = transition(state, action);
	}

	async function submitToken() {
		if (validating) return;
		validating = true;
		try {
			const trimmed = tokenInput.trim();
			if (!trimmed) {
				state = { ...state, error: 'Please paste a token.' };
				return;
			}
			const tokenCheck = await validateToken(trimmed);
			if (!tokenCheck.valid) {
				state = { ...state, error: 'GitHub did not accept that token. Double-check it and try again.' };
				return;
			}
			const repoCheck = await validateRepo(trimmed, state.repoOwner, state.repoName);
			if (!repoCheck.valid) {
				state = {
					...state,
					error: repoCheck.error ?? 'Token is valid but can\u2019t access that repo. Check permissions and repo scope.'
				};
				return;
			}
			if (!repoCheck.canWrite) {
				state = {
					...state,
					error: 'Token works but does not have push access to this repo. Re-create it with Contents: Read and write.'
				};
				return;
			}
			// Success — commit to the state machine, then to githubState
			state = transition({ ...state, token: trimmed }, { type: 'submit-token', value: trimmed });
			const newGhState = {
				isAuthenticated: true,
				username: tokenCheck.username,
				token: trimmed,
				authMethod: 'pat' as const,
				repoOwner: state.repoOwner,
				repoName: state.repoName,
				isConnected: false,
				syncStatus: 'idle' as const,
				pendingChanges: []
			};
			githubState.set(newGhState);
			saveGitHubState(newGhState);
			clearWizardState();
			goto(`${base}/connect`);
		} finally {
			validating = false;
		}
	}

	function submitRepo() {
		act({ type: 'submit-repo', value: repoInput });
		repoInput = '';
	}

	const IRONHAVEN_URL = 'https://github.com/CYOAGame/ironhaven';
	const NEW_PAT_URL =
		'https://github.com/settings/personal-access-tokens/new?description=Journal+RPG';
</script>

<div class="wizard-page">
	<div class="wizard-inner">
		<header class="wizard-header">
			<h1 class="title">Fine-Grained Access Token</h1>
			<p class="subtitle">Per-repo scope — your token can only touch one world.</p>
		</header>

		{#if state.step === 'choose'}
			<section class="section">
				<h2 class="section-title">What do you want to do?</h2>
				<button class="btn btn-primary" onclick={() => act({ type: 'pick-create' })}>
					Create a new world
				</button>
				<p class="section-desc">
					You'll fork the <code>CYOAGame/ironhaven</code> template on GitHub, then
					create a PAT scoped to your fork.
				</p>
				<div class="divider"></div>
				<button class="btn btn-secondary" onclick={() => act({ type: 'pick-join' })}>
					Join a world I'm already a collaborator on
				</button>
				<p class="section-desc">
					You'll create a PAT scoped to that specific world repo.
				</p>
			</section>
		{:else if state.step === 'create-step1'}
			<section class="section">
				<h2 class="section-title">Step 1 of 2 — Fork the template</h2>
				<ol class="steps">
					<li>
						<a href={IRONHAVEN_URL} target="_blank" rel="noopener noreferrer">
							Open CYOAGame/ironhaven on GitHub
						</a>
						and click <strong>Fork</strong>.
					</li>
					<li>After the fork completes, come back here and paste the fork URL below.</li>
				</ol>
				<input
					class="field-input"
					type="text"
					placeholder="your-username/ironhaven"
					bind:value={repoInput}
					onkeydown={(e) => { if (e.key === 'Enter') submitRepo(); }}
				/>
				{#if state.error}<p class="error-msg">{state.error}</p>{/if}
				<div class="actions">
					<button class="btn btn-secondary" onclick={() => act({ type: 'back' })}>Back</button>
					<button class="btn btn-primary" onclick={submitRepo}>Next</button>
				</div>
			</section>
		{:else if state.step === 'join-step1'}
			<section class="section">
				<h2 class="section-title">Step 1 of 2 — Confirm your world repo</h2>
				<p class="section-desc">
					You must already be a collaborator on this repo. If you aren't, ask the
					world owner to add you (or use <a href="{base}/login">Login with GitHub</a>).
				</p>
				<input
					class="field-input"
					type="text"
					placeholder="owner/repo"
					bind:value={repoInput}
					onkeydown={(e) => { if (e.key === 'Enter') submitRepo(); }}
				/>
				{#if state.error}<p class="error-msg">{state.error}</p>{/if}
				<div class="actions">
					<button class="btn btn-secondary" onclick={() => act({ type: 'back' })}>Back</button>
					<button class="btn btn-primary" onclick={submitRepo}>Next</button>
				</div>
			</section>
		{:else if state.step === 'create-step2' || state.step === 'join-step2'}
			<section class="section">
				<h2 class="section-title">Step 2 of 2 — Create a PAT</h2>
				<p class="section-desc">
					For <code>{state.repoOwner}/{state.repoName}</code>:
				</p>
				<ol class="steps">
					<li>
						<a href={NEW_PAT_URL} target="_blank" rel="noopener noreferrer">
							Open the GitHub fine-grained PAT page
						</a>
					</li>
					<li>
						Under <strong>Repository access</strong>, choose
						<em>Only select repositories</em> and pick
						<code>{state.repoOwner}/{state.repoName}</code>.
					</li>
					<li>
						Under <strong>Repository permissions</strong>, grant:
						<ul>
							<li><strong>Contents:</strong> Read and write</li>
							<li><strong>Metadata:</strong> Read (already required)</li>
							<li><strong>Pull requests:</strong> Read and write</li>
						</ul>
					</li>
					<li>Click <strong>Generate token</strong> and paste it below.</li>
				</ol>
				<p class="warning">
					Heads up: if you forget the <strong>Pull requests</strong> permission,
					login will still succeed but your first save will fail. Come back here
					to update the token if that happens.
				</p>
				<input
					class="field-input"
					type="password"
					placeholder="github_pat_..."
					bind:value={tokenInput}
					onkeydown={(e) => { if (e.key === 'Enter') submitToken(); }}
					disabled={validating}
				/>
				{#if state.error}<p class="error-msg">{state.error}</p>{/if}
				<div class="actions">
					<button class="btn btn-secondary" onclick={() => act({ type: 'back' })} disabled={validating}>Back</button>
					<button class="btn btn-primary" onclick={submitToken} disabled={validating || !tokenInput.trim()}>
						{validating ? 'Validating...' : 'Connect'}
					</button>
				</div>
			</section>
		{/if}

		<div class="footer-links">
			<a href="{base}/login" class="footer-link">Back to login</a>
		</div>
	</div>
</div>

<style>
	.wizard-page {
		min-height: 100vh;
		background-color: var(--session-end-bg);
		color: var(--session-end-text);
		font-family: var(--journal-font);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 1rem;
	}
	.wizard-inner { width: 100%; max-width: 520px; }
	.wizard-header { text-align: center; margin-bottom: 2rem; }
	.title {
		font-size: 2rem;
		color: var(--journal-accent);
		margin: 0 0 0.5rem 0;
		font-weight: normal;
		letter-spacing: 0.04em;
	}
	.subtitle { font-size: 0.9rem; opacity: 0.6; margin: 0; font-style: italic; }
	.section {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.section-title {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.55;
		font-weight: normal;
		margin: 0;
	}
	.section-desc { font-size: 0.85rem; opacity: 0.7; line-height: 1.6; margin: 0; }
	.steps { font-size: 0.88rem; line-height: 1.7; margin: 0; padding-left: 1.2rem; }
	.steps code, .section-desc code {
		font-family: monospace;
		background: rgba(255, 255, 255, 0.07);
		padding: 0.1em 0.3em;
		border-radius: 2px;
	}
	.warning {
		font-size: 0.82rem;
		color: #e0c890;
		background: rgba(180, 150, 60, 0.12);
		border: 1px solid rgba(180, 150, 60, 0.35);
		border-radius: 4px;
		padding: 0.55rem 0.75rem;
		margin: 0;
		line-height: 1.5;
	}
	.field-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.85rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--session-end-border);
		border-radius: 4px;
		color: var(--session-end-text);
		font-family: monospace;
		font-size: 0.9rem;
	}
	.field-input:focus { outline: none; border-color: var(--journal-accent); }
	.field-input:disabled { opacity: 0.5; }
	.error-msg {
		font-size: 0.85rem;
		color: #e09090;
		background: rgba(180, 60, 60, 0.15);
		border: 1px solid rgba(180, 60, 60, 0.4);
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		margin: 0;
	}
	.actions { display: flex; gap: 0.75rem; margin-top: 0.5rem; }
	.btn {
		padding: 0.6rem 1.5rem;
		border-radius: 4px;
		font-family: var(--journal-font);
		font-size: 0.95rem;
		cursor: pointer;
		transition: opacity 0.15s;
		letter-spacing: 0.03em;
		flex: 1;
	}
	.btn:disabled { cursor: not-allowed; opacity: 0.4; }
	.btn-primary { background: var(--journal-accent); border: none; color: #fff8ee; }
	.btn-primary:hover:not(:disabled) { opacity: 0.88; }
	.btn-secondary {
		background: transparent;
		border: 1px solid var(--session-end-border);
		color: var(--session-end-text);
	}
	.btn-secondary:hover:not(:disabled) { border-color: var(--journal-accent); opacity: 0.9; }
	.divider { height: 1px; background: var(--session-end-border); margin: 0.25rem 0; }
	.footer-links { text-align: center; margin-top: 1.5rem; }
	.footer-link {
		font-size: 0.82rem;
		color: var(--session-end-text);
		opacity: 0.35;
		text-decoration: none;
		letter-spacing: 0.06em;
	}
	.footer-link:hover { opacity: 0.7; }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: the new route compiles cleanly. The same login/connect/settings errors from earlier tasks remain until Task 13 and 14.

- [ ] **Step 3: Commit**

```bash
git add src/routes/login/pat-wizard/+page.svelte
git commit -m "feat(auth): add PAT wizard page with create and join variants"
```

---

## Task 13: Rewire `login/+page.svelte` for OAuth + PAT wizard entry

**Files:**
- Modify: `src/routes/login/+page.svelte`

- [ ] **Step 1: Replace the login page**

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { validateToken } from '$lib/git/github-client';
	import { githubState, saveGitHubState, clearAuth } from '$lib/stores/github';
	import { onMount } from 'svelte';
	import { env as publicEnv } from '$env/dynamic/public';

	const CLIENT_ID = publicEnv.PUBLIC_GITHUB_CLIENT_ID ?? '';
	const WORKER_URL = publicEnv.PUBLIC_OAUTH_WORKER_URL ?? '';
	const OAUTH_CONFIGURED = Boolean(CLIENT_ID && WORKER_URL);

	let connecting = $state(false);
	let errorMessage = $state('');

	onMount(async () => {
		const oauthToken = page.url.searchParams.get('token');
		const oauthError = page.url.searchParams.get('error');
		const returnedState = page.url.searchParams.get('state');
		const method = page.url.searchParams.get('method');

		if (oauthError === 'expired') {
			errorMessage = 'Your GitHub session expired. Please reconnect.';
			return;
		}
		if (oauthError) {
			errorMessage = `GitHub login failed: ${decodeURIComponent(oauthError)}`;
			return;
		}
		if (oauthToken && method === 'oauth') {
			const expected = sessionStorage.getItem('oauth-state');
			sessionStorage.removeItem('oauth-state');
			if (!expected || expected !== returnedState) {
				errorMessage = 'Login state did not match — please try again.';
				return;
			}
			await completeLogin(oauthToken, 'oauth');
		}
	});

	function randomState(): string {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	function startOAuth() {
		if (!OAUTH_CONFIGURED) {
			errorMessage = 'OAuth is not configured for this deployment. See tools/README.md.';
			return;
		}
		const state = randomState();
		sessionStorage.setItem('oauth-state', state);
		const redirectUri = encodeURIComponent(`${WORKER_URL}/callback`);
		const encodedState = encodeURIComponent(state);
		const authorizeUrl =
			`https://github.com/login/oauth/authorize` +
			`?client_id=${encodeURIComponent(CLIENT_ID)}` +
			`&scope=repo` +
			`&redirect_uri=${redirectUri}` +
			`&state=${encodedState}`;
		window.location.href = authorizeUrl;
	}

	async function completeLogin(token: string, authMethod: 'oauth' | 'pat') {
		connecting = true;
		errorMessage = '';
		try {
			const result = await validateToken(token);
			if (!result.valid) {
				clearAuth();
				errorMessage = 'GitHub did not accept that token. Please try again.';
				return;
			}
			const newState = {
				isAuthenticated: true,
				username: result.username,
				token,
				authMethod,
				repoOwner: '',
				repoName: '',
				isConnected: false,
				syncStatus: 'idle' as const,
				pendingChanges: []
			};
			githubState.set(newState);
			saveGitHubState(newState);
			goto(`${base}/connect`);
		} catch {
			errorMessage = 'Connection failed. Check your network and try again.';
		} finally {
			connecting = false;
		}
	}

	function goToPatWizard() {
		goto(`${base}/login/pat-wizard`);
	}
</script>

<div class="login-page">
	<div class="login-inner">
		<header class="login-header">
			<h1 class="title">Journal RPG</h1>
			<p class="subtitle">Connect to GitHub to save your world</p>
		</header>

		{#if errorMessage}
			<p class="error-msg">{errorMessage}</p>
		{/if}

		<section class="section section-oauth">
			<button class="btn btn-primary" onclick={startOAuth} disabled={connecting || !OAUTH_CONFIGURED}>
				{connecting ? 'Connecting...' : 'Login with GitHub'}
			</button>
			<p class="section-desc">
				Fastest path. Grants read/write access to your GitHub repositories — scope is the
				same as any other GitHub-integrated dev tool.
			</p>
			{#if !OAUTH_CONFIGURED}
				<p class="oauth-note">
					OAuth is not configured. See <code>tools/README.md</code> to register an OAuth App
					and deploy the token exchange worker.
				</p>
			{/if}
		</section>

		<div class="divider">
			<span class="divider-text">or</span>
		</div>

		<section class="section">
			<h2 class="section-title">Fine-Grained Access Token</h2>
			<p class="section-desc">
				Skeptic path. Create a GitHub token scoped to <em>exactly one</em> repo. The game
				cannot touch any of your other repositories.
			</p>
			<button class="btn btn-secondary" onclick={goToPatWizard} disabled={connecting}>
				Use a Personal Access Token
			</button>
		</section>

		<div class="footer-links">
			<a href="{base}/?offline=true" class="footer-link">Play Offline</a>
		</div>
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		background-color: var(--session-end-bg);
		color: var(--session-end-text);
		font-family: var(--journal-font);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 1rem;
	}
	.login-inner { width: 100%; max-width: 440px; }
	.login-header { text-align: center; margin-bottom: 2rem; }
	.title {
		font-size: 2.5rem;
		color: var(--journal-accent);
		margin: 0 0 0.5rem 0;
		letter-spacing: 0.04em;
		font-weight: normal;
	}
	.subtitle { font-size: 0.95rem; opacity: 0.6; margin: 0; font-style: italic; }
	.section {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 1.5rem;
		margin-bottom: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.section-oauth { text-align: center; }
	.section-title {
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.5;
		font-weight: normal;
		margin: 0;
	}
	.section-desc { font-size: 0.85rem; opacity: 0.65; line-height: 1.6; margin: 0; }
	.section-desc code, .oauth-note code {
		font-family: monospace;
		background: rgba(255, 255, 255, 0.07);
		padding: 0.1em 0.3em;
		border-radius: 2px;
	}
	.oauth-note {
		font-size: 0.78rem;
		opacity: 0.5;
		margin: 0;
		line-height: 1.5;
	}
	.btn {
		padding: 0.6rem 1.5rem;
		border-radius: 4px;
		font-family: var(--journal-font);
		font-size: 0.95rem;
		cursor: pointer;
		transition: opacity 0.15s;
		letter-spacing: 0.03em;
		width: 100%;
	}
	.btn:disabled { cursor: not-allowed; opacity: 0.4; }
	.btn-primary { background: var(--journal-accent); border: none; color: #fff8ee; }
	.btn-primary:hover:not(:disabled) { opacity: 0.88; }
	.btn-secondary {
		background: transparent;
		border: 1px solid var(--session-end-border);
		color: var(--session-end-text);
	}
	.btn-secondary:hover:not(:disabled) { border-color: var(--journal-accent); opacity: 0.9; }
	.divider {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 1rem 0;
	}
	.divider::before, .divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--session-end-border);
	}
	.divider-text {
		font-size: 0.8rem;
		opacity: 0.4;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.error-msg {
		font-size: 0.85rem;
		color: #e09090;
		background: rgba(180, 60, 60, 0.15);
		border: 1px solid rgba(180, 60, 60, 0.4);
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		margin: 0 0 1rem 0;
	}
	.footer-links { text-align: center; margin-top: 1.5rem; }
	.footer-link {
		font-size: 0.82rem;
		color: var(--session-end-text);
		opacity: 0.35;
		text-decoration: none;
		letter-spacing: 0.06em;
	}
	.footer-link:hover { opacity: 0.7; }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: login page no longer errors. Connect and settings still error until Task 14.

- [ ] **Step 3: Commit**

```bash
git add src/routes/login/+page.svelte
git commit -m "feat(auth): wire oauth button, add expired banner, link to PAT wizard"
```

---

## Task 14: Update `connect/+page.svelte`, `settings/+page.svelte`, and `+page.svelte` for new token source

**Files:**
- Modify: `src/routes/connect/+page.svelte`
- Modify: `src/routes/settings/+page.svelte`
- Modify: `src/routes/+page.svelte` *(added during execution — the root index page also reads `prefs.githubToken` in `onMount` and `continueFromGitHub()`; see "Index page patch" sub-steps below)*

- [ ] **Step 1: Check settings page for token references**

Run: `grep -n "githubToken\|githubUsername" src/routes/settings/+page.svelte`

Note each location. If settings does not reference the token at all, skip the settings patch — proceed to step 2 with just connect.

- [ ] **Step 2: Patch `connect/+page.svelte` — read token from store, gate Create World, use clearAuth on logout**

Make these specific edits:

1. **Replace the token-reading pattern in every handler.** Change every instance of
   ```typescript
   const prefs = loadPlayerPrefs();
   const tkn = prefs.githubToken ?? token;
   if (!tkn) { goto(`${base}/login`); return; }
   ```
   to
   ```typescript
   const tkn = $githubState.token;
   if (!tkn) { goto(`${base}/login`); return; }
   ```
   Locations: `connectToRepo`, `handleCreateWorld`, `handleJoinPublicWorld`, `handleJoinWorld`. Also update `handleSync` to read `$githubState.token` and `$githubState.repoOwner`/`.repoName` instead of `prefs`.

2. **Gate `handleCreateWorld` on `authMethod`.** Replace the whole function body:
   ```typescript
   async function handleCreateWorld() {
       if ($githubState.authMethod === 'pat') {
           forkError = 'Create World requires "Login with GitHub". Log out and use the OAuth path, or create your world via the PAT wizard during login.';
           return;
       }
       forking = true;
       forkError = '';
       try {
           const tkn = $githubState.token;
           if (!tkn) { goto(`${base}/login`); return; }
           const result = await forkRepo(tkn, 'CYOAGame', 'ironhaven');
           if (!result) {
               forkError = 'Template repo not found or forbidden. If you authenticated with a fine-grained PAT, use the PAT wizard instead.';
               return;
           }
           await connectToRepo(result.owner, result.repo);
       } catch (err: any) {
           forkError = err?.message ?? 'Fork failed. Please try again.';
       } finally {
           forking = false;
       }
   }
   ```

3. **Replace `handleLogout` to use `clearAuth`:**
   ```typescript
   function handleLogout() {
       const prefs = loadPlayerPrefs();
       savePlayerPrefs({ ...prefs, repoOwner: undefined, repoName: undefined });
       clearAuth();
       goto(`${base}/login`);
   }
   ```
   And add `clearAuth` to the import from `$lib/stores/github`.

4. **Update the `onMount` gate:**
   ```typescript
   onMount(() => {
       if (!$githubState.token) {
           goto(`${base}/login`);
           return;
       }
       const prefs = loadPlayerPrefs();
       if (prefs.repoOwner && prefs.repoName) {
           recentOwner = prefs.repoOwner;
           recentRepo = prefs.repoName;
       }
   });
   ```

- [ ] **Step 3: Patch `settings/+page.svelte` if needed**

For any reference like `prefs.githubToken`, replace with `$githubState.token`, and add the import `import { githubState } from '$lib/stores/github';` at the top if it's not already there. For any `prefs.githubUsername`, replace with `$githubState.username`.

- [ ] **Step 3b: Patch `src/routes/+page.svelte` (the root index page)**

This file was missed from the original plan inventory but also reads `prefs.githubToken` / `prefs.githubUsername` in `onMount` and `continueFromGitHub()`. Apply the same principle: read auth from `$githubState`, use `clearAuth()` for the "token invalid" path.

Specific edits:

1. Add `clearAuth` to the existing `githubState` import:
   ```typescript
   import { githubState } from '$lib/stores/github';
   ```
   becomes
   ```typescript
   import { githubState, clearAuth } from '$lib/stores/github';
   ```

2. **Rewrite the `onMount` auth-check block.** Replace the whole block that starts with `const prefs = loadPlayerPrefs();` and handles the `if (prefs.githubToken)` branch (currently around lines 37-62) with:
   ```typescript
   const prefs = loadPlayerPrefs();
   const token = $githubState.token;
   if (token) {
       const result = await validateToken(token);
       if (result.valid) {
           if (prefs.repoOwner && prefs.repoName) {
               authMode = 'github-ready';
               // Background check for upstream updates
               checkForkStatus(token, prefs.repoOwner, prefs.repoName).then(status => {
                   if (status?.behind) updateAvailable = true;
               });
           } else {
               goto(`${base}/connect`);
               return;
           }
       } else {
           // Token invalid — clear it and redirect to login
           clearAuth();
           goto(`${base}/login`);
           return;
       }
   } else {
       // Not logged in — redirect to login
       goto(`${base}/login`);
       return;
   }
   ```

3. **Rewrite `continueFromGitHub`.** Replace its body (currently around lines 67-103) with:
   ```typescript
   async function continueFromGitHub() {
       const prefs = loadPlayerPrefs();
       const token = $githubState.token;
       if (!token || !prefs.repoOwner || !prefs.repoName) {
           goto(`${base}/connect`);
           return;
       }
       // Always fetch fresh from repo (cache may be stale after upstream sync)
       let files: Map<string, string>;
       try {
           files = await fetchRepoFiles(token, prefs.repoOwner, prefs.repoName);
           cacheFiles(files);
       } catch {
           // Offline fallback — use cache
           const cached = loadCachedFiles();
           if (!cached) {
               goto(`${base}/connect`);
               return;
           }
           files = cached;
       }
       const blocks = buildWorldBlocksFromFiles(files);
       const state = buildWorldStateFromFiles(files, blocks.config);
       worldBlocks.set(blocks);
       worldState.set(state);
       saveWorldBlocks(blocks);
       saveWorldState(state);
       githubState.update(s => ({
           ...s,
           isAuthenticated: true,
           repoOwner: prefs.repoOwner!,
           repoName: prefs.repoName!,
           isConnected: true
       }));
       goto(`${base}/journal/setup`);
   }
   ```
   (Note: `username` and `token` are removed from the `githubState.update` call because they should already be in the store — we're reading from them above, not writing.)

- [ ] **Step 4: Typecheck**

Run: `npm run check`
Expected: **zero errors**. This is the first task where the full project should typecheck cleanly.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/connect/+page.svelte src/routes/settings/+page.svelte
git commit -m "feat(auth): route connect and settings to githubState, gate Create World on authMethod"
```

---

## Task 15: Catch `AuthExpiredError` at the `saveWithPR` call site

**Files:**
- Modify: `src/routes/session-end/+page.svelte`

**Why:** Task 6 made `repo-writer.ts` propagate `AuthExpiredError` instead of swallowing 401s. The only runtime call site of `saveWithPR` is `session-end/+page.svelte:179`. Its current broad `catch (err)` block at line 192 would just set `syncStatus: 'error'` and stay on the session-end screen, leaving the user looking at a stale UI with no token. We need to catch `AuthExpiredError` specifically and redirect to `/login?error=expired`.

- [ ] **Step 1: Add imports**

At the top of `src/routes/session-end/+page.svelte` (near the other imports), add:

```typescript
import { AuthExpiredError } from '$lib/git/auth-errors';
```

If `goto` and `base` are not already imported (check the existing imports), also add:

```typescript
import { goto } from '$app/navigation';
import { base } from '$app/paths';
```

- [ ] **Step 2: Update the catch block**

Find the block at `src/routes/session-end/+page.svelte` around lines 192-194:

```typescript
} catch (err: any) {
	githubState.update(s => ({ ...s, syncStatus: 'error', syncError: err.message }));
}
```

Replace it with:

```typescript
} catch (err: any) {
	if (err instanceof AuthExpiredError) {
		// clearAuth() was already called inside handleRequest — just bounce.
		goto(`${base}/login?error=expired`);
		return updated;
	}
	githubState.update(s => ({ ...s, syncStatus: 'error', syncError: err.message }));
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: zero errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/session-end/+page.svelte
git commit -m "feat(auth): redirect to login on AuthExpiredError during save"
```

---

## Task 16: Manual verification

**Files:** none modified — this task validates end-to-end behavior before calling the feature done. Deployment of the Cloudflare Worker and GitHub OAuth App registration are prerequisites (see `tools/README.md`).

- [ ] **Step 1: Verify a fresh install has a clean UI**

1. Run `npm run dev`.
2. Open `http://localhost:5173` in a private/incognito window.
3. Navigate to `/login`.
4. Confirm you see both "Login with GitHub" and "Use a Personal Access Token" options. If OAuth env vars are missing, the OAuth button should be disabled with the `tools/README.md` note.

- [ ] **Step 2: PAT create-variant end-to-end**

1. Click "Use a Personal Access Token" → pick "Create a new world."
2. Fork `CYOAGame/ironhaven` manually on github.com in a second tab.
3. Paste the fork (e.g. `yourname/ironhaven`) and click Next.
4. Create a fine-grained PAT with the three required permissions on github.com.
5. Paste the token, click Connect.
6. You should land on `/connect`. The "Recent World" section should not appear (fresh install). Click "Join Public World" or navigate to your new fork manually.
7. Play a brief session that triggers at least one save. Confirm the save succeeds (no error banner on session-end).

- [ ] **Step 3: PAT join-variant end-to-end**

1. Clear localStorage (`localStorage.clear()` in DevTools console) and reload.
2. Click "Use a Personal Access Token" → pick "Join."
3. Enter `CYOAGame/Public_Game` (or a shared world you're a collaborator on).
4. Create a PAT scoped to that repo with the three required permissions.
5. Paste and Connect.
6. Play a brief session that saves. Confirm success.

- [ ] **Step 4: OAuth happy path**

1. Clear localStorage and reload.
2. Click "Login with GitHub."
3. Authorize on github.com.
4. Should return to `/login` and auto-forward to `/connect`.
5. Click "Create New World." Confirm a fork is created on your account and you land in the journal setup.

- [ ] **Step 5: Expiry mid-save**

1. While logged in via PAT, revoke the token on github.com (Settings → Developer settings → Personal access tokens → Delete).
2. In the running game, trigger a save (e.g. complete a day in the journal).
3. You should be redirected to `/login?error=expired` with the banner
   "Your GitHub session expired. Please reconnect."
4. Confirm `localStorage.getItem('journal-rpg-github-state')` shows `token: ""`.

- [ ] **Step 6: Reload mid-wizard**

1. Clear localStorage and reload.
2. Navigate to PAT wizard → pick Create → submit a repo → on step 2, reload the page.
3. Confirm the wizard resumes at step 2 with the repo still shown.

- [ ] **Step 7: State mismatch rejection**

1. Clear localStorage and reload.
2. Click "Login with GitHub" but cancel on github.com.
3. Manually craft a URL like `/login?token=fake&method=oauth&state=wrong` and open it.
4. Confirm the error banner says "Login state did not match" and no session is stored.

- [ ] **Step 8: Legacy migration**

1. In a fresh private window, before opening the app, set a legacy key in localStorage via DevTools:
   ```javascript
   localStorage.setItem('journal-rpg-player-prefs', JSON.stringify({
     dayTypePreferences: [],
     llmSetting: 'none',
     githubToken: 'ghp_test',
     githubUsername: 'legacy',
     repoOwner: 'legacy',
     repoName: 'world'
   }));
   ```
2. Navigate to the app.
3. Inspect localStorage:
   - `journal-rpg-player-prefs` should no longer have `githubToken`/`githubUsername`.
   - `journal-rpg-github-state` should have `token: "ghp_test"`, `username: "legacy"`, `authMethod: null`.

- [ ] **Step 9: Final regression**

Run: `npm test && npm run check`
Expected: all tests pass, zero typecheck errors.

- [ ] **Step 10: Commit the manual-test completion if anything was fixed along the way**

If manual testing surfaced bugs, fix them in targeted commits with clear messages. If everything worked as designed, no commit is needed for this task.

---

## Final self-review checklist

Once all 16 tasks are done, verify:

- [ ] All spec sections have at least one task:
  - OAuth deployment → Tasks 7, 8, 9, 10, 13
  - PAT wizard → Tasks 11, 12, 13
  - `githubState` + `clearAuth` → Task 2
  - `playerPrefs` migration → Task 3
  - `handleRequest` wrapper → Tasks 4, 5
  - `repo-writer` wrapping → Task 6
  - Connect + Create World gating → Task 14
  - Expiry handling → Tasks 4 (wrapper), 13 (banner), 15 (session-end catch)
  - Manual test checklist → Task 16
- [ ] No task contains TODO/TBD/placeholder text.
- [ ] Function/type/variable names are consistent across tasks:
  `AuthExpiredError`, `handleRequest`, `clearAuth`, `authMethod`, `saveGitHubState`,
  `WizardState`, `transition`, `saveWizardState`, `loadWizardState`, `clearWizardState`.
- [ ] Every code step contains complete code, not a diff summary.
- [ ] Every commit step has an exact `git add` + `git commit -m` pair.

---

## Out of scope (do not build in this plan)

- **Owner-approved private-world invites.** Separate follow-up feature.
- **GitHub App foundation.** Deferred. The current plan keeps the door open:
  `authMethod` is extensible, installation tokens flow through the same
  `githubState` + `handleRequest` plumbing without structural change.
- **Refactoring `repo-writer.ts`.** Only the Octokit calls are wrapped.
  The branch/PR/merge orchestration is unchanged.
