import { describe, it, expect, beforeEach } from 'vitest';
import { parseRepoUrl, handleRequest } from '../../src/lib/git/github-client';
import { AuthExpiredError } from '../../src/lib/git/auth-errors';
import { githubState } from '../../src/lib/stores/github';
import { get } from 'svelte/store';

describe('parseRepoUrl', () => {
	it('parses a full GitHub URL', () => {
		expect(parseRepoUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
	});
	it('parses owner/repo shorthand', () => {
		expect(parseRepoUrl('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
	});
	it('strips trailing slashes and .git', () => {
		expect(parseRepoUrl('https://github.com/owner/repo.git/')).toEqual({ owner: 'owner', repo: 'repo' });
	});
	it('returns null for invalid URLs', () => {
		expect(parseRepoUrl('')).toBeNull();
		expect(parseRepoUrl('not-a-url')).toBeNull();
		expect(parseRepoUrl('https://github.com/')).toBeNull();
	});
});

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
