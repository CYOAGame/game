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
