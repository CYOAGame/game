import { writable } from 'svelte/store';

export interface PlayerPrefs {
	dayTypePreferences: string[];
	llmSetting: 'none' | 'local' | 'claude';
	llmEndpoint?: string;
	llmModel?: string;
	llmApiKey?: string;
}

const DEFAULT_PREFS: PlayerPrefs = {
	dayTypePreferences: [],
	llmSetting: 'none'
};

export const playerPrefs = writable<PlayerPrefs>(DEFAULT_PREFS);

export function loadPlayerPrefs(): PlayerPrefs {
	if (typeof localStorage === 'undefined') return DEFAULT_PREFS;
	const raw = localStorage.getItem('journal-rpg-player-prefs');
	if (!raw) return DEFAULT_PREFS;
	return JSON.parse(raw) as PlayerPrefs;
}

export function savePlayerPrefs(prefs: PlayerPrefs): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem('journal-rpg-player-prefs', JSON.stringify(prefs));
}
