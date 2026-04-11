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
