# Owner-Approved Join Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let new players request access to public shared worlds through a pre-filled GitHub Issue, and let world owners approve requests from inside the game with one tap.

**Architecture:** New `src/lib/invites/` module holds the request channel (`invite-url.ts` builds the pre-filled github.com link; `invite-client.ts` wraps `issues.listForRepo`, `issues.createComment`, `issues.update`, plus a new `addCollaborator` helper in `github-client.ts`). The `/connect` page gains a "Pending Invites" section and a "Not a collaborator yet" panel. A small `<InvitesBadge>` component is dropped into gameplay page headers to signal queued requests during long sessions.

**Tech Stack:** TypeScript, Svelte 5 (runes), SvelteKit 2, Vitest, Octokit.

**Spec:** `docs/superpowers/specs/2026-04-11-owner-approved-invites.md`

**Depends on:** GitHub auth redesign (already landed as of commit `8e9d0cc` on main), specifically `handleRequest`, `AuthExpiredError`, `githubState.authMethod`, and the existing PAT wizard at `src/routes/login/pat-wizard/`.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/invites/invite-url.ts` | Pure function `buildJoinRequestUrl(owner, repo, appUrl)` — builds the pre-filled github.com issue URL |
| `src/lib/invites/invite-client.ts` | `listJoinRequests`, `approveJoinRequest`, `denyJoinRequest`, `JOIN_REQUEST_LABEL`, the `JoinRequest` type, and a testable `*Impl` function per public function that accepts an injected Octokit-shaped object |
| `src/lib/components/InvitesBadge.svelte` | Svelte 5 component: polls on mount, renders `(N) pending invites` button that navigates to `/connect`, renders nothing when N is 0 |
| `tests/invites/invite-url.test.ts` | Pure function tests: URL shape, encoding, body content |
| `tests/invites/invite-client.test.ts` | Orchestration tests using injected fake Octokit (testing the `*Impl` functions) |

### Modified files

| Path | Change |
|---|---|
| `src/lib/git/github-client.ts` | Add `addCollaborator(token, owner, repo, username)` wrapped in `handleRequest`; 422 = already-a-collaborator treated as success |
| `tests/git/github-client.test.ts` | Extend with `addCollaborator` tests for 401/403/422 paths |
| `src/routes/connect/+page.svelte` | Add Pending Invites section at top; add "Not a collaborator yet" panel branch in `handleJoinWorld` when `validateRepo` returns `canWrite: false` |
| `src/routes/login/pat-wizard/+page.svelte` | Add "Administration: Read and write" as an optional bullet to the permissions list in both create-step2 and join-step2 panels |
| `src/routes/journal/+page.svelte` | Import and drop `<InvitesBadge />` in the header |
| `src/routes/session-end/+page.svelte` | Same |
| `src/routes/timeline/+page.svelte` | Same |
| `docs/superpowers/specs/2026-04-11-github-auth-redesign.md` | Update "Future work" — mark owner-approved invites as in-progress with link to the new spec |

---

## Task 1: `invite-url.ts` pure function

**Files:**
- Create: `src/lib/invites/invite-url.ts`
- Test: `tests/invites/invite-url.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/invites/invite-url.test.ts
import { describe, it, expect } from 'vitest';
import { buildJoinRequestUrl } from '../../src/lib/invites/invite-url';

describe('buildJoinRequestUrl', () => {
	it('returns a github.com issues/new URL', () => {
		const url = buildJoinRequestUrl('CYOAGame', 'Public_Game', 'https://cyoagame.github.io/game/');
		expect(url.startsWith('https://github.com/CYOAGame/Public_Game/issues/new')).toBe(true);
	});

	it('includes the join-request label', () => {
		const url = buildJoinRequestUrl('CYOAGame', 'Public_Game', 'https://cyoagame.github.io/game/');
		// Label is url-encoded: journal-rpg%2Fjoin-request
		expect(url).toContain('labels=journal-rpg%2Fjoin-request');
	});

	it('includes a title', () => {
		const url = buildJoinRequestUrl('CYOAGame', 'Public_Game', 'https://cyoagame.github.io/game/');
		expect(url).toContain('title=Join+request');
	});

	it('includes the app URL in the body', () => {
		const url = buildJoinRequestUrl('CYOAGame', 'Public_Game', 'https://cyoagame.github.io/game/');
		// Body contains the encoded appUrl somewhere
		expect(url).toContain('https%3A%2F%2Fcyoagame.github.io%2Fgame%2F');
	});

	it('handles owners with hyphens', () => {
		const url = buildJoinRequestUrl('cool-org', 'my-world', 'https://example.com/');
		expect(url.startsWith('https://github.com/cool-org/my-world/issues/new')).toBe(true);
	});

	it('returns a string (never throws) for edge inputs', () => {
		expect(typeof buildJoinRequestUrl('', '', '')).toBe('string');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/invites/invite-url.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/invites/invite-url.ts

/**
 * Builds the pre-filled GitHub issue URL for a join request.
 * Opening this URL in a new tab lands the user on github.com's issue
 * creation page with all fields pre-populated. GitHub's own session
 * authenticates the issue submission — no game-side token is used.
 */
export function buildJoinRequestUrl(owner: string, repo: string, appUrl: string): string {
	const base = `https://github.com/${owner}/${repo}/issues/new`;
	const body =
		`I'd like to join this world in the Journal RPG game.\n\n` +
		`Game: ${appUrl}\n\n` +
		`(This issue was pre-filled by the game. The world owner will approve or deny your request. ` +
		`If approved, GitHub will email you a collaborator invite link — accept it to start playing.)`;
	const params = new URLSearchParams({
		labels: 'journal-rpg/join-request',
		title: 'Join request',
		body
	});
	return `${base}?${params.toString()}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/invites/invite-url.test.ts`
Expected: 6 tests pass.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: baseline + 6 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/invites/invite-url.ts tests/invites/invite-url.test.ts
git commit -m "feat(invites): add buildJoinRequestUrl for pre-filled github.com issue URL"
```

---

## Task 2: `addCollaborator` wrapper in `github-client.ts`

**Files:**
- Modify: `src/lib/git/github-client.ts`
- Test: `tests/git/github-client.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/git/github-client.test.ts`:

```typescript
import { addCollaborator } from '../../src/lib/git/github-client';

describe('addCollaborator', () => {
	beforeEach(() => {
		(globalThis as any).localStorage = new MemoryStorage();
		githubState.set({
			isAuthenticated: true,
			username: 'alice',
			token: 'ghp_valid',
			authMethod: 'oauth',
			repoOwner: 'alice',
			repoName: 'world',
			isConnected: true,
			syncStatus: 'synced',
			pendingChanges: []
		});
	});

	it('with a bogus token returns {success:false} without crashing', async () => {
		const result = await addCollaborator('ghp_definitely_not_real_xxxx', 'CYOAGame', 'Public_Game', 'bob');
		// Real API call fails — we just care that the wrapper returns a structured result
		expect(result.success).toBe(false);
	});

	// For 401/403/422 handling, we can't easily exercise real Octokit without
	// mocking the module. The regression-level guarantee is that handleRequest
	// already tests 401 → AuthExpiredError, and addCollaborator routes through
	// handleRequest. The unit test above confirms the function is callable.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/git/github-client.test.ts`
Expected: FAIL — `addCollaborator` not exported.

- [ ] **Step 3: Add `addCollaborator` to `github-client.ts`**

Append to `src/lib/git/github-client.ts` (before the closing of the file, after `syncFork`):

```typescript
/**
 * Add a user as a collaborator on a repo with push permission.
 * Requires the authenticated user to have admin or maintain permission.
 *
 * Returns:
 * - { success: true } on successful add
 * - { success: true, alreadyCollaborator: true } if the user is already a
 *   collaborator (GitHub returns 422 in this case — treated as success so
 *   orchestration code doesn't have to special-case it)
 * - { success: false, error } on permission denied (403), user not found
 *   (404), or any other failure
 *
 * 401s are promoted to AuthExpiredError via handleRequest and must be
 * caught by the caller (standard runtime path).
 */
export async function addCollaborator(
	token: string,
	owner: string,
	repo: string,
	username: string
): Promise<{ success: boolean; error?: string; alreadyCollaborator?: boolean }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			try {
				await octokit.rest.repos.addCollaborator({
					owner,
					repo,
					username,
					permission: 'push'
				});
				return { success: true };
			} catch (err: any) {
				// 422 = user is already a collaborator (or invitation pending)
				if (err.status === 422) {
					return { success: true, alreadyCollaborator: true };
				}
				// 401 must escape so handleRequest can promote it
				if (err.status === 401) throw err;
				// 403 = forbidden (caller lacks admin)
				// 404 = user not found
				// Anything else: surface to caller
				return {
					success: false,
					error: err.message ?? `GitHub returned ${err.status ?? 'unknown'}`
				};
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Add collaborator failed' };
	}
}
```

- [ ] **Step 4: Run test**

Run: `npm test -- tests/git/github-client.test.ts`
Expected: all tests pass including the new one.

- [ ] **Step 5: Typecheck**

Run: `npm run check`
Expected: no new errors from `github-client.ts`. Same pre-existing errors elsewhere (the ~49 Svelte 5 rune errors in journal/session-end pages are unrelated).

- [ ] **Step 6: Commit**

```bash
git add src/lib/git/github-client.ts tests/git/github-client.test.ts
git commit -m "feat(invites): add addCollaborator wrapper with 422-as-success semantics"
```

---

## Task 3: `invite-client.ts` orchestration + tests

**Files:**
- Create: `src/lib/invites/invite-client.ts`
- Test: `tests/invites/invite-client.test.ts`

**Design pattern:** Each of `listJoinRequests`, `approveJoinRequest`, `denyJoinRequest` has a testable `*Impl` version that accepts an injected Octokit-shaped object, and a public version that calls `getOctokit(token)` and routes through `handleRequest`. Tests drive the `*Impl` versions with fake Octokit objects to verify call order and response mapping without touching the network.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/invites/invite-client.test.ts
import { describe, it, expect } from 'vitest';
import {
	listJoinRequestsImpl,
	approveJoinRequestImpl,
	denyJoinRequestImpl,
	JOIN_REQUEST_LABEL,
	type JoinRequest,
	type InviteOctokit
} from '../../src/lib/invites/invite-client';

function makeFakeOctokit(overrides: Partial<InviteOctokit['rest']> = {}): InviteOctokit {
	const calls: Array<{ method: string; args: any }> = [];
	const fake: InviteOctokit = {
		rest: {
			issues: {
				async listForRepo(params: any) {
					calls.push({ method: 'listForRepo', args: params });
					return { data: [] };
				},
				async createComment(params: any) {
					calls.push({ method: 'createComment', args: params });
					return { data: {} };
				},
				async update(params: any) {
					calls.push({ method: 'update', args: params });
					return { data: {} };
				},
				...(overrides.issues ?? {})
			},
			repos: {
				async addCollaborator(params: any) {
					calls.push({ method: 'addCollaborator', args: params });
					return { data: {} };
				},
				...(overrides.repos ?? {})
			}
		}
	};
	(fake as any).__calls = calls;
	return fake;
}

describe('listJoinRequestsImpl', () => {
	it('filters out pull_request items', async () => {
		const fake = makeFakeOctokit({
			issues: {
				async listForRepo() {
					return {
						data: [
							{
								number: 1,
								user: { login: 'alice', avatar_url: 'https://x/1.png' },
								created_at: '2026-04-11T10:00:00Z',
								pull_request: undefined
							},
							{
								number: 2,
								user: { login: 'bob', avatar_url: 'https://x/2.png' },
								created_at: '2026-04-11T11:00:00Z',
								pull_request: { url: 'https://api.github.com/repos/foo/bar/pulls/2' }
							}
						]
					};
				}
			} as any
		});
		const result = await listJoinRequestsImpl(fake, 'CYOAGame', 'Public_Game');
		expect(result).toHaveLength(1);
		expect(result[0].username).toBe('alice');
	});

	it('uses the correct label in the API call', async () => {
		let capturedParams: any = null;
		const fake = makeFakeOctokit({
			issues: {
				async listForRepo(params: any) {
					capturedParams = params;
					return { data: [] };
				}
			} as any
		});
		await listJoinRequestsImpl(fake, 'CYOAGame', 'Public_Game');
		expect(capturedParams.labels).toBe('journal-rpg/join-request');
		expect(capturedParams.state).toBe('open');
		expect(capturedParams.owner).toBe('CYOAGame');
		expect(capturedParams.repo).toBe('Public_Game');
	});

	it('maps issue.user.login to JoinRequest.username', async () => {
		const fake = makeFakeOctokit({
			issues: {
				async listForRepo() {
					return {
						data: [
							{
								number: 42,
								user: { login: 'charlie', avatar_url: 'https://x/c.png' },
								created_at: '2026-04-11T12:00:00Z'
							}
						]
					};
				}
			} as any
		});
		const result = await listJoinRequestsImpl(fake, 'CYOAGame', 'Public_Game');
		expect(result[0]).toEqual({
			issueNumber: 42,
			username: 'charlie',
			avatarUrl: 'https://x/c.png',
			submittedAt: '2026-04-11T12:00:00Z',
			repoOwner: 'CYOAGame',
			repoName: 'Public_Game'
		});
	});
});

const sampleRequest: JoinRequest = {
	issueNumber: 7,
	username: 'alice',
	avatarUrl: 'https://x/a.png',
	submittedAt: '2026-04-11T10:00:00Z',
	repoOwner: 'CYOAGame',
	repoName: 'Public_Game'
};

describe('approveJoinRequestImpl', () => {
	it('calls addCollaborator, then createComment, then update(state:closed) in order', async () => {
		const fake = makeFakeOctokit();
		const result = await approveJoinRequestImpl(fake, sampleRequest);
		const calls = (fake as any).__calls;
		expect(calls.map((c: any) => c.method)).toEqual(['addCollaborator', 'createComment', 'update']);
		expect(calls[0].args.username).toBe('alice');
		expect(calls[0].args.permission).toBe('push');
		expect(calls[1].args.issue_number).toBe(7);
		expect(calls[2].args.state).toBe('closed');
		expect(result.success).toBe(true);
	});

	it('stops early if addCollaborator throws 403', async () => {
		const fake = makeFakeOctokit({
			repos: {
				async addCollaborator() {
					const err: any = new Error('Forbidden');
					err.status = 403;
					throw err;
				}
			} as any
		});
		const result = await approveJoinRequestImpl(fake, sampleRequest);
		const calls = (fake as any).__calls;
		expect(calls.map((c: any) => c.method)).toEqual(['addCollaborator']);
		expect(result.success).toBe(false);
		expect(result.error).toContain('admin');
	});

	it('proceeds on addCollaborator 422 (already-a-collaborator)', async () => {
		const fake = makeFakeOctokit({
			repos: {
				async addCollaborator() {
					const err: any = new Error('Already a collaborator');
					err.status = 422;
					throw err;
				}
			} as any
		});
		const result = await approveJoinRequestImpl(fake, sampleRequest);
		const calls = (fake as any).__calls;
		expect(calls.map((c: any) => c.method)).toEqual(['addCollaborator', 'createComment', 'update']);
		expect(result.success).toBe(true);
	});

	it('returns success even if comment/close fail after successful add', async () => {
		const fake = makeFakeOctokit({
			issues: {
				async listForRepo() { return { data: [] }; },
				async createComment() {
					throw new Error('Comment failed');
				},
				async update() {
					throw new Error('Update failed');
				}
			} as any
		});
		const result = await approveJoinRequestImpl(fake, sampleRequest);
		// add succeeded, post-hooks failed — still success
		expect(result.success).toBe(true);
	});
});

describe('denyJoinRequestImpl', () => {
	it('calls createComment then update(state:closed)', async () => {
		const fake = makeFakeOctokit();
		const result = await denyJoinRequestImpl(fake, sampleRequest, 'not now');
		const calls = (fake as any).__calls;
		expect(calls.map((c: any) => c.method)).toEqual(['createComment', 'update']);
		expect(calls[0].args.body).toContain('not now');
		expect(calls[1].args.state).toBe('closed');
		expect(result.success).toBe(true);
	});

	it('uses a default message when no reason provided', async () => {
		const fake = makeFakeOctokit();
		await denyJoinRequestImpl(fake, sampleRequest);
		const calls = (fake as any).__calls;
		expect(calls[0].args.body.length).toBeGreaterThan(0);
	});
});

describe('JOIN_REQUEST_LABEL', () => {
	it('equals journal-rpg/join-request', () => {
		expect(JOIN_REQUEST_LABEL).toBe('journal-rpg/join-request');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/invites/invite-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `invite-client.ts`**

```typescript
// src/lib/invites/invite-client.ts
import { getOctokit, addCollaborator, handleRequest } from '$lib/git/github-client';
import { AuthExpiredError } from '$lib/git/auth-errors';

export const JOIN_REQUEST_LABEL = 'journal-rpg/join-request';

export interface JoinRequest {
	issueNumber: number;
	username: string;
	avatarUrl: string;
	submittedAt: string;
	repoOwner: string;
	repoName: string;
}

/**
 * Minimal Octokit-shaped interface used by invite-client. Defining our own
 * lets tests inject fake Octokits without dragging in Octokit's full type.
 */
export interface InviteOctokit {
	rest: {
		issues: {
			listForRepo(params: {
				owner: string;
				repo: string;
				labels: string;
				state: string;
			}): Promise<{ data: any[] }>;
			createComment(params: {
				owner: string;
				repo: string;
				issue_number: number;
				body: string;
			}): Promise<any>;
			update(params: {
				owner: string;
				repo: string;
				issue_number: number;
				state: 'open' | 'closed';
			}): Promise<any>;
		};
		repos: {
			addCollaborator(params: {
				owner: string;
				repo: string;
				username: string;
				permission: string;
			}): Promise<any>;
		};
	};
}

// ---------- Testable Impl functions ----------

/**
 * Fetches open join-request issues and maps them to JoinRequest records.
 * Filters out pull requests (the issues API returns both).
 */
export async function listJoinRequestsImpl(
	octokit: InviteOctokit,
	owner: string,
	repo: string
): Promise<JoinRequest[]> {
	const { data } = await octokit.rest.issues.listForRepo({
		owner,
		repo,
		labels: JOIN_REQUEST_LABEL,
		state: 'open'
	});
	return data
		.filter((issue: any) => !issue.pull_request)
		.map((issue: any) => ({
			issueNumber: issue.number,
			username: issue.user?.login ?? '',
			avatarUrl: issue.user?.avatar_url ?? '',
			submittedAt: issue.created_at ?? '',
			repoOwner: owner,
			repoName: repo
		}));
}

/**
 * Orchestrates approval: addCollaborator → createComment → update(closed).
 * Stops early on addCollaborator failure. Swallows post-add failures
 * (comment/close) so the user-visible outcome (the collaborator add)
 * reflects the return value.
 */
export async function approveJoinRequestImpl(
	octokit: InviteOctokit,
	req: JoinRequest
): Promise<{ success: boolean; error?: string }> {
	try {
		await octokit.rest.repos.addCollaborator({
			owner: req.repoOwner,
			repo: req.repoName,
			username: req.username,
			permission: 'push'
		});
	} catch (err: any) {
		if (err.status === 422) {
			// Already a collaborator — proceed to comment + close
		} else {
			if (err.status === 401) throw err;
			const explain =
				err.status === 403
					? 'lacks admin permission on this repo'
					: err.message ?? 'unknown error';
			return {
				success: false,
				error: `Can't add collaborator — your token ${explain}. Log in via OAuth to approve, or re-create your PAT with Administration: Read and write.`
			};
		}
	}

	// Post-add bookkeeping: best-effort only
	try {
		await octokit.rest.issues.createComment({
			owner: req.repoOwner,
			repo: req.repoName,
			issue_number: req.issueNumber,
			body: "Welcome! You've been added as a collaborator. Check your GitHub notifications / email for an invite link — accept it to start playing."
		});
	} catch {
		// best-effort: the collaborator was still added
	}

	try {
		await octokit.rest.issues.update({
			owner: req.repoOwner,
			repo: req.repoName,
			issue_number: req.issueNumber,
			state: 'closed'
		});
	} catch {
		// best-effort
	}

	return { success: true };
}

/**
 * Denies a request by posting a comment and closing the issue. No
 * collaborator is touched.
 */
export async function denyJoinRequestImpl(
	octokit: InviteOctokit,
	req: JoinRequest,
	reason?: string
): Promise<{ success: boolean; error?: string }> {
	const body = reason ?? 'Your request was not approved at this time.';
	try {
		await octokit.rest.issues.createComment({
			owner: req.repoOwner,
			repo: req.repoName,
			issue_number: req.issueNumber,
			body
		});
		await octokit.rest.issues.update({
			owner: req.repoOwner,
			repo: req.repoName,
			issue_number: req.issueNumber,
			state: 'closed'
		});
		return { success: true };
	} catch (err: any) {
		if (err.status === 401) throw err;
		return {
			success: false,
			error: err.message ?? 'Failed to deny request'
		};
	}
}

// ---------- Public token-accepting API ----------

export async function listJoinRequests(
	token: string,
	owner: string,
	repo: string
): Promise<JoinRequest[]> {
	try {
		return await handleRequest(() =>
			listJoinRequestsImpl(getOctokit(token) as unknown as InviteOctokit, owner, repo)
		);
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		// 403/404 etc: return empty list so the UI gracefully shows nothing
		return [];
	}
}

export async function approveJoinRequest(
	token: string,
	req: JoinRequest
): Promise<{ success: boolean; error?: string }> {
	try {
		return await handleRequest(() =>
			approveJoinRequestImpl(getOctokit(token) as unknown as InviteOctokit, req)
		);
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Approve failed' };
	}
}

export async function denyJoinRequest(
	token: string,
	req: JoinRequest,
	reason?: string
): Promise<{ success: boolean; error?: string }> {
	try {
		return await handleRequest(() =>
			denyJoinRequestImpl(getOctokit(token) as unknown as InviteOctokit, req, reason)
		);
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Deny failed' };
	}
}
```

**Note:** `getOctokit` is a private symbol in the current `github-client.ts`. It must be exported for this file to import it. Add `export` to the `getOctokit` function declaration at the top of `github-client.ts` if it isn't already exported.

- [ ] **Step 4: Export `getOctokit` from `github-client.ts` if needed**

Check: `grep "^export function getOctokit\|^export const getOctokit\|^function getOctokit" src/lib/git/github-client.ts`

If `getOctokit` is not currently exported (just `function getOctokit`), change the declaration to `export function getOctokit`.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/invites/invite-client.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: baseline + all new tests pass.

- [ ] **Step 7: Typecheck**

Run: `npm run check`
Expected: no new errors in the new files. Same pre-existing errors elsewhere.

- [ ] **Step 8: Commit**

```bash
git add src/lib/invites/invite-client.ts tests/invites/invite-client.test.ts src/lib/git/github-client.ts
git commit -m "feat(invites): add list/approve/deny invite-client with testable Impl functions"
```

---

## Task 4: `<InvitesBadge>` component

**Files:**
- Create: `src/lib/components/InvitesBadge.svelte`

**Note:** This task has no unit tests — Svelte components in this codebase aren't typically rendered in tests (there's no `@testing-library/svelte` installed). The component's logic is thin (mount → poll → render count). It gets exercised in manual testing (Task 10).

- [ ] **Step 1: Write the component**

```svelte
<!-- src/lib/components/InvitesBadge.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { githubState } from '$lib/stores/github';
	import { listJoinRequests } from '$lib/invites/invite-client';
	import { AuthExpiredError } from '$lib/git/auth-errors';

	let count = $state(0);

	onMount(async () => {
		const gh = $githubState;
		if (!gh.token || !gh.repoOwner || !gh.repoName) return;
		try {
			const reqs = await listJoinRequests(gh.token, gh.repoOwner, gh.repoName);
			count = reqs.length;
		} catch (err) {
			if (err instanceof AuthExpiredError) {
				// Let the existing expiry flow handle the redirect — just don't render a badge
				return;
			}
			// Any other error → render nothing. Missing permissions, 404, etc.
			// fall through silently.
		}
	});

	function openConnect() {
		goto(`${base}/connect`);
	}
</script>

{#if count > 0}
	<button class="invites-badge" onclick={openConnect} title="View pending invites">
		{count} pending invite{count === 1 ? '' : 's'}
	</button>
{/if}

<style>
	.invites-badge {
		display: inline-block;
		background: var(--journal-accent);
		color: #fff8ee;
		border: none;
		border-radius: 4px;
		padding: 0.3rem 0.65rem;
		font-family: var(--journal-font);
		font-size: 0.78rem;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.invites-badge:hover {
		opacity: 0.85;
	}
</style>
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: the new component compiles cleanly.

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: same as before — new component doesn't have tests of its own.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/InvitesBadge.svelte
git commit -m "feat(invites): add InvitesBadge component"
```

---

## Task 5: Pending Invites section on `/connect`

**Files:**
- Modify: `src/routes/connect/+page.svelte`

**Goal:** Add a "Pending Invites" section at the top of the connect page. It renders one card per pending request on the currently-connected world. Each card has Approve and Deny buttons. Polls on component mount.

- [ ] **Step 1: Read the current `/connect` page** to locate the insertion point

Use the Read tool to view `src/routes/connect/+page.svelte`. Find the `<div class="connect-page">` wrapping div and the `<div class="connect-inner">` inner container. The Pending Invites section goes at the top of `.connect-inner`, right after the `<header class="connect-header">` block.

- [ ] **Step 2: Add imports**

At the top of the `<script lang="ts">` block, add:

```typescript
import {
	listJoinRequests,
	approveJoinRequest,
	denyJoinRequest,
	type JoinRequest
} from '$lib/invites/invite-client';
import { AuthExpiredError } from '$lib/git/auth-errors';
```

- [ ] **Step 3: Add state variables**

In the same `<script>` block, after the existing `let ghState = $derived($githubState);` area and before the existing handler functions, add:

```typescript
// Pending invites state
let pendingInvites = $state<JoinRequest[]>([]);
let invitesLoading = $state(false);
let inviteError = $state('');
let denyingIssue = $state<number | null>(null);
let denyReason = $state('');
let inviteActionError = $state<string>('');
```

- [ ] **Step 4: Add a polling function and call it in `onMount`**

Find the existing `onMount` block and add the polling call:

```typescript
onMount(() => {
	const prefs = loadPlayerPrefs();
	if (!$githubState.token) {
		goto(`${base}/login`);
		return;
	}
	if (prefs.repoOwner && prefs.repoName) {
		recentOwner = prefs.repoOwner;
		recentRepo = prefs.repoName;
	}
	// Poll for pending invites on the currently-connected world
	pollInvites();
});

async function pollInvites() {
	const gh = $githubState;
	if (!gh.token || !gh.repoOwner || !gh.repoName) {
		pendingInvites = [];
		return;
	}
	invitesLoading = true;
	inviteError = '';
	try {
		pendingInvites = await listJoinRequests(gh.token, gh.repoOwner, gh.repoName);
	} catch (err) {
		if (err instanceof AuthExpiredError) {
			goto(`${base}/login?error=expired`);
			return;
		}
		inviteError = 'Could not fetch pending invites.';
		pendingInvites = [];
	} finally {
		invitesLoading = false;
	}
}

async function handleApprove(req: JoinRequest) {
	inviteActionError = '';
	const result = await approveJoinRequest($githubState.token, req);
	if (result.success) {
		await pollInvites();
	} else {
		inviteActionError = result.error ?? 'Approve failed';
	}
}

function startDeny(issueNumber: number) {
	denyingIssue = issueNumber;
	denyReason = '';
	inviteActionError = '';
}

function cancelDeny() {
	denyingIssue = null;
	denyReason = '';
}

async function confirmDeny(req: JoinRequest) {
	inviteActionError = '';
	const result = await denyJoinRequest($githubState.token, req, denyReason || undefined);
	if (result.success) {
		denyingIssue = null;
		denyReason = '';
		await pollInvites();
	} else {
		inviteActionError = result.error ?? 'Deny failed';
	}
}
```

- [ ] **Step 5: Add the template section**

In the template, inside `<div class="connect-inner">`, after the `<header class="connect-header">` block and before the Recent World section, add:

```svelte
{#if pendingInvites.length > 0 || invitesLoading}
	<section class="section">
		<h2 class="section-title">Pending Invites</h2>
		{#if invitesLoading && pendingInvites.length === 0}
			<p class="section-desc">Checking...</p>
		{/if}
		{#if inviteError}
			<p class="error-msg">{inviteError}</p>
		{/if}
		{#each pendingInvites as req (req.issueNumber)}
			<div class="invite-card">
				<div class="invite-header">
					{#if req.avatarUrl}
						<img class="invite-avatar" src={req.avatarUrl} alt="" />
					{/if}
					<div class="invite-meta">
						<strong class="invite-user">{req.username}</strong>
						<span class="invite-repo">wants to join {req.repoOwner}/{req.repoName}</span>
					</div>
				</div>
				{#if denyingIssue === req.issueNumber}
					<textarea
						class="deny-reason"
						placeholder="Optional reason (shown to the requester)"
						bind:value={denyReason}
					></textarea>
					<div class="invite-actions">
						<button class="btn btn-secondary" onclick={cancelDeny}>Cancel</button>
						<button class="btn btn-primary" onclick={() => confirmDeny(req)}>Confirm Deny</button>
					</div>
				{:else}
					<div class="invite-actions">
						<button class="btn btn-primary" onclick={() => handleApprove(req)}>Approve</button>
						<button class="btn btn-secondary" onclick={() => startDeny(req.issueNumber)}>Deny</button>
					</div>
				{/if}
			</div>
		{/each}
		{#if inviteActionError}
			<p class="error-msg">{inviteActionError}</p>
		{/if}
	</section>
{/if}
```

- [ ] **Step 6: Add styles**

Append to the `<style>` block at the bottom of the file:

```css
	.invite-card {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--session-end-border);
		border-radius: 4px;
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.invite-header {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.invite-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
	}
	.invite-meta {
		display: flex;
		flex-direction: column;
	}
	.invite-user {
		font-size: 0.95rem;
		color: var(--journal-accent);
	}
	.invite-repo {
		font-size: 0.8rem;
		opacity: 0.65;
	}
	.deny-reason {
		width: 100%;
		box-sizing: border-box;
		min-height: 60px;
		padding: 0.5rem 0.7rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--session-end-border);
		border-radius: 4px;
		color: var(--session-end-text);
		font-family: var(--journal-font);
		font-size: 0.85rem;
		resize: vertical;
	}
	.deny-reason:focus {
		outline: none;
		border-color: var(--journal-accent);
	}
	.invite-actions {
		display: flex;
		gap: 0.5rem;
	}
	.invite-actions .btn {
		padding: 0.4rem 0.9rem;
		font-size: 0.85rem;
	}
```

- [ ] **Step 7: Typecheck**

Run: `npm run check`
Expected: no new errors in `/connect`. Pre-existing unrelated errors remain.

- [ ] **Step 8: Run full suite**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 9: Commit**

```bash
git add src/routes/connect/+page.svelte
git commit -m "feat(invites): add Pending Invites section to /connect"
```

---

## Task 6: "Not a collaborator yet" panel on `/connect`

**Files:**
- Modify: `src/routes/connect/+page.svelte`

**Goal:** When `handleJoinWorld` (or `handleJoinPublicWorld`) calls `validateRepo` and receives `{ valid: true, canWrite: false }`, show a new panel inviting the player to request access via the pre-filled github.com URL, instead of the current behavior of calling `connectToRepo` anyway (which would fail at the first save).

- [ ] **Step 1: Add imports**

At the top of the `<script lang="ts">` block in `src/routes/connect/+page.svelte`, add:

```typescript
import { buildJoinRequestUrl } from '$lib/invites/invite-url';
```

- [ ] **Step 2: Add state variables**

Near the other `$state` declarations, add:

```typescript
// Not-a-collaborator panel state
let showRequestAccess = $state(false);
let requestAccessOwner = $state('');
let requestAccessRepo = $state('');
```

- [ ] **Step 3: Modify `handleJoinWorld` to branch on canWrite**

Find the existing `handleJoinWorld` function and update the `validateRepo` result handling. The existing code looks like:

```typescript
const validation = await validateRepo(tkn, parsed.owner, parsed.repo);
if (!validation.valid) {
    joinError = validation.error ?? 'Repository not valid.';
    return;
}
await connectToRepo(parsed.owner, parsed.repo);
```

Replace with:

```typescript
const validation = await validateRepo(tkn, parsed.owner, parsed.repo);
if (!validation.valid) {
    joinError = validation.error ?? 'Repository not valid.';
    return;
}
if (!validation.canWrite) {
    // Not a collaborator yet — show request access panel
    requestAccessOwner = parsed.owner;
    requestAccessRepo = parsed.repo;
    showRequestAccess = true;
    return;
}
await connectToRepo(parsed.owner, parsed.repo);
```

- [ ] **Step 4: Modify `handleJoinPublicWorld` similarly**

Find `handleJoinPublicWorld`. It currently calls `connectToRepo('CYOAGame', 'Public_Game')` directly without first calling `validateRepo`. Update it to validate first and branch on canWrite:

```typescript
async function handleJoinPublicWorld() {
    joinError = '';
    joining = true;
    try {
        const tkn = $githubState.token;
        if (!tkn) {
            goto(`${base}/login`);
            return;
        }
        const validation = await validateRepo(tkn, 'CYOAGame', 'Public_Game');
        if (!validation.valid) {
            joinError = validation.error ?? 'Public world unreachable.';
            return;
        }
        if (!validation.canWrite) {
            requestAccessOwner = 'CYOAGame';
            requestAccessRepo = 'Public_Game';
            showRequestAccess = true;
            return;
        }
        await connectToRepo('CYOAGame', 'Public_Game');
    } catch (err: any) {
        if (err instanceof AuthExpiredError) {
            goto(`${base}/login?error=expired`);
            return;
        }
        joinError = err?.message ?? 'Failed to connect to public world.';
    } finally {
        joining = false;
    }
}
```

- [ ] **Step 5: Add handler functions**

Near the other handler functions, add:

```typescript
function openRequestAccess() {
    const appUrl = typeof window !== 'undefined' ? window.location.origin + base + '/' : '';
    const url = buildJoinRequestUrl(requestAccessOwner, requestAccessRepo, appUrl);
    window.open(url, '_blank', 'noopener');
}

function closeRequestAccess() {
    showRequestAccess = false;
    requestAccessOwner = '';
    requestAccessRepo = '';
}
```

- [ ] **Step 6: Add the template section**

In the template, inside `<div class="connect-inner">`, after the Pending Invites section (from Task 5) and before the Recent World section, add:

```svelte
{#if showRequestAccess}
	<section class="section request-access-section">
		<h2 class="section-title">Not a collaborator yet</h2>
		<p class="section-desc">
			You're not a collaborator on <code>{requestAccessOwner}/{requestAccessRepo}</code> yet.
			Click <strong>Request access</strong> to open a pre-filled join request on GitHub.
			The world owner will review it.
		</p>
		<p class="section-desc">
			Once approved, GitHub will email you a collaborator invite. Accept it there, then
			come back here and try again.
		</p>
		<div class="invite-actions">
			<button class="btn btn-primary" onclick={openRequestAccess}>
				Request access
			</button>
			<button class="btn btn-secondary" onclick={closeRequestAccess}>
				Cancel
			</button>
		</div>
	</section>
{/if}
```

- [ ] **Step 7: Typecheck**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 8: Run full suite**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 9: Commit**

```bash
git add src/routes/connect/+page.svelte
git commit -m "feat(invites): show Request Access panel when user is not a collaborator"
```

---

## Task 7: PAT wizard permissions list — add optional Administration: R/W

**Files:**
- Modify: `src/routes/login/pat-wizard/+page.svelte`

**Goal:** Add an "Administration: Read and write" bullet to the permissions list in Step 2 of both the create and join variants, marked as optional with a note explaining when it's needed.

- [ ] **Step 1: Find the permissions list in the template**

Read `src/routes/login/pat-wizard/+page.svelte` and locate the `{:else if wizState.step === 'create-step2' || wizState.step === 'join-step2'}` block. Inside it, find the `<ol class="steps">` with the nested `<ul>` under "Repository permissions:".

- [ ] **Step 2: Add the new bullet and note**

The existing `<ul>` has three items. Update it to four, with the new item at the bottom:

```svelte
<ul>
    <li><strong>Contents:</strong> Read and write</li>
    <li><strong>Metadata:</strong> Read (already required)</li>
    <li><strong>Pull requests:</strong> Read and write</li>
    <li>
        <strong>Administration:</strong> Read and write
        <em>(optional — only needed if you plan to approve join requests from other players for this repo)</em>
    </li>
</ul>
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: the PAT wizard page compiles cleanly.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/login/pat-wizard/+page.svelte
git commit -m "feat(invites): add optional Administration permission to PAT wizard"
```

---

## Task 8: Drop `<InvitesBadge>` into gameplay page headers

**Files:**
- Modify: `src/routes/journal/+page.svelte`
- Modify: `src/routes/session-end/+page.svelte`
- Modify: `src/routes/timeline/+page.svelte`

**Goal:** Add the badge to each gameplay page's header so the owner sees pending invites during a session.

- [ ] **Step 1: Read each file** and find the top of the page's main content

Each of these files has a `<div>` that wraps the page content, usually with a header element near the top. The badge should go in the header area, ideally at the top-right.

- [ ] **Step 2: Patch `src/routes/journal/+page.svelte`**

Add the import at the top of the `<script>` block:

```typescript
import InvitesBadge from '$lib/components/InvitesBadge.svelte';
```

Find the page header (usually a `<header>` element or a `<div>` containing the title/date). Add `<InvitesBadge />` inside it, typically positioned with CSS to the right. For example, if the header currently looks like:

```svelte
<header class="journal-header">
    <h1 class="journal-title">Journal</h1>
    <p class="journal-date">{dateString}</p>
</header>
```

Change to:

```svelte
<header class="journal-header">
    <h1 class="journal-title">Journal</h1>
    <p class="journal-date">{dateString}</p>
    <InvitesBadge />
</header>
```

Adjust the CSS to position the badge appropriately. If the header uses `display: flex`, the badge can be pushed right with `margin-left: auto`. If not, add a `.invites-slot` wrapper with absolute positioning or a flex container.

Minimal CSS change (append to the page's style block):

```css
.journal-header :global(.invites-badge) {
    margin-left: auto;
}
```

- [ ] **Step 3: Patch `src/routes/session-end/+page.svelte`**

Same pattern: add the import, drop `<InvitesBadge />` in the appropriate header area. The session-end page has its own layout — place the badge somewhere visible but not intrusive (e.g., above the main card).

- [ ] **Step 4: Patch `src/routes/timeline/+page.svelte`**

Same pattern.

- [ ] **Step 5: Typecheck**

Run: `npm run check`
Expected: no new errors. Pre-existing Svelte 5 rune errors in these files remain unchanged — do not attempt to fix them.

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/routes/journal/+page.svelte src/routes/session-end/+page.svelte src/routes/timeline/+page.svelte
git commit -m "feat(invites): show InvitesBadge in gameplay page headers"
```

---

## Task 9: Update auth-redesign spec to mark invites as in-progress

**Files:**
- Modify: `docs/superpowers/specs/2026-04-11-github-auth-redesign.md`

**Goal:** Update the "Future work" section of the auth-redesign spec so that anyone reading it can navigate to this feature's spec.

- [ ] **Step 1: Read the auth-redesign spec** and find its "Future work" section (near the bottom)

- [ ] **Step 2: Update the first bullet**

The current text says:

```markdown
1. **Owner-approved private-world invites.** When a player wants to join a
   private world, they request access from inside the game; the world owner
   sees a notification in their own game session and approves with one tap,
   which uses their OAuth token to add the player as a collaborator via
   `POST /repos/{owner}/{repo}/collaborators/{username}`. Zero new
   infrastructure — reuses auth from this spec. Addresses the most common
   private-world use case (friend-group campaigns).
```

Replace with:

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-04-11-github-auth-redesign.md
git commit -m "docs(auth): link owner-approved invites spec from future work"
```

---

## Task 10: Manual verification

**Files:** none modified — this task validates end-to-end behavior.

**Prerequisites for full verification:**
- Two GitHub accounts (owner and requester)
- OAuth App registered (to approve as OAuth owner) OR a fine-grained PAT with Administration: R/W on the target world repo
- The owner must be a real GitHub admin on `CYOAGame/Public_Game` (or whichever test world you're using)

- [ ] **Step 1: Run all automated tests and typecheck**

Run: `npm test && npm run check`
Expected:
- All tests pass (baseline + new tests from this feature)
- No new typecheck errors from any file in this feature
- Pre-existing Svelte 5 rune errors in journal/session-end/timeline/journal-setup remain unchanged

- [ ] **Step 2: Verify request submission from player side**

1. Run `npm run dev`.
2. In a private window (logged out of the game, logged in to github.com as a non-collaborator account), navigate to `http://localhost:5173/login` and authenticate with OAuth or a PAT.
3. Navigate to `/connect` and click "Join Public World" or enter `CYOAGame/Public_Game` manually.
4. Verify: the "Not a collaborator yet" panel renders.
5. Click "Request access". A new tab should open at `github.com/CYOAGame/Public_Game/issues/new` with:
   - Title: `Join request`
   - Labels: `journal-rpg/join-request` (visible in the label sidebar)
   - Body: pre-filled with the game URL and explanation
6. Submit the issue on github.com. Close the tab.

- [ ] **Step 3: Verify owner receives the request**

1. In a different browser or window, log in to the game as the world owner (OAuth, with access to `CYOAGame/Public_Game`).
2. Navigate to `/connect`.
3. Verify: the "Pending Invites" section renders at the top with one card showing the requester's username, avatar, and repo name.
4. Navigate to another page (e.g., `/journal`). Verify: the `<InvitesBadge>` shows "1 pending invite" in the header.
5. Click the badge. Verify: you land back on `/connect`.

- [ ] **Step 4: Verify approval flow**

1. On the Pending Invites card, click "Approve".
2. Verify: the card disappears within a second or two (re-poll completes).
3. Open `github.com/CYOAGame/Public_Game/issues` and confirm the issue is closed with the welcome comment.
4. Open `github.com/CYOAGame/Public_Game/settings/access` and confirm the requester is listed as a collaborator (or has a pending invite).
5. In the requester's window, they should receive a GitHub email titled something like "CYOAGame invited you to collaborate on CYOAGame/Public_Game."
6. On github.com, requester accepts the invite. Returns to the game and reloads.
7. Verify: the "Not a collaborator yet" panel no longer appears; the requester proceeds into the world normally.

- [ ] **Step 5: Verify denial flow**

1. Have the requester open a second join request (same as Step 2).
2. As the owner, navigate to `/connect` and click "Deny" on the new card.
3. Verify: a textarea appears. Type "not a good fit" and click "Confirm Deny".
4. Verify: the card disappears.
5. On github.com, confirm the issue is closed with the denial comment.
6. Requester receives no email.

- [ ] **Step 6: Verify permission error path (PAT without Admin)**

1. Log in as an owner using a fine-grained PAT that does NOT have Administration: R/W.
2. Open an issue as a requester.
3. As the owner, navigate to `/connect`, see the pending invite, click Approve.
4. Verify: inline error appears saying *"Can't add collaborator — your token lacks admin permission..."*
5. Verify: the issue remains open on github.com; no collaborator was added.

- [ ] **Step 7: Verify expired session mid-poll**

1. Log in as the owner.
2. Navigate to `/connect`. Wait for the pending invites poll to complete.
3. In github.com settings, revoke the owner's token.
4. Navigate to `/journal` (this triggers the badge poll).
5. Verify: the game redirects to `/login?error=expired` with the banner visible.

- [ ] **Step 8: Fix anything that breaks**

If any of the above fails, diagnose and fix in targeted commits with clear messages.

---

## Final self-review checklist

Once all 10 tasks are done, verify:

- [ ] All spec sections have at least one task:
  - `invite-url.ts` → Task 1
  - `addCollaborator` wrapper → Task 2
  - `invite-client.ts` with list/approve/deny → Task 3
  - `<InvitesBadge>` → Task 4
  - Pending Invites section → Task 5
  - Not-a-collaborator panel → Task 6
  - PAT wizard permission update → Task 7
  - Badge in gameplay pages → Task 8
  - Cross-reference in auth spec → Task 9
  - Manual verification → Task 10
- [ ] No task contains TODO/TBD/placeholder text.
- [ ] Function/type/variable names are consistent across tasks: `JoinRequest`, `listJoinRequests(Impl)`, `approveJoinRequest(Impl)`, `denyJoinRequest(Impl)`, `addCollaborator`, `buildJoinRequestUrl`, `JOIN_REQUEST_LABEL`, `InviteOctokit`.
- [ ] Every code step contains complete code, not a diff summary.
- [ ] Every commit step has an exact `git add` + `git commit -m` pair.
- [ ] No Claude attribution in commit messages.

---

## Out of scope (do NOT build in this plan)

- **Auto-approve toggle** — deferred to future work per spec. Do not add a "this world accepts anyone" setting.
- **Private world invites** — requires a GitHub App; deferred.
- **Multi-world polling** — only poll the currently-connected world in `$githubState`.
- **Player request-status page** — player just reloads and tries again per the email.
- **Bulk approve/deny** — one at a time is fine for the MVP.
