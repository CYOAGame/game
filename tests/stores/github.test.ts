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
			authMethod: 'pat',
			repoOwner: 'alice',
			repoName: 'world',
			isConnected: true,
			syncStatus: 'synced',
			pendingChanges: []
		});
		const loaded = loadGitHubState();
		expect(loaded.token).toBe('ghp_secret');
		expect(loaded.authMethod).toBe('pat');
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
