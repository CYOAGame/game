import { writable, derived } from 'svelte/store';

export interface GitHubState {
	isAuthenticated: boolean;
	username: string;
	token: string;
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
	const { token, ...rest } = state;
	localStorage.setItem(GH_STATE_KEY, JSON.stringify(rest));
}

export function loadGitHubState(): Partial<GitHubState> {
	if (typeof localStorage === 'undefined') return {};
	const raw = localStorage.getItem(GH_STATE_KEY);
	if (!raw) return {};
	return JSON.parse(raw);
}
