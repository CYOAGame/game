import { writable, derived, get } from 'svelte/store';

export type AuthMethod = 'pat' | 'invite-code' | null;

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

// Hydrate from localStorage so the session survives page reloads.
// Without this, the store starts empty on every full page load and
// the user gets bounced to the landing page even if they have a
// valid token persisted from a previous session.
function getInitialState(): GitHubState {
	const saved = loadGitHubState();
	if (saved.token) {
		return { ...DEFAULT_STATE, ...saved } as GitHubState;
	}
	return DEFAULT_STATE;
}

export const githubState = writable<GitHubState>(getInitialState());

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
