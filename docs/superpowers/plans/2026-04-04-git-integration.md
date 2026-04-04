# Git Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace localStorage with GitHub as the world's source of truth — authenticate with GitHub, load world YAML from repos, write state back via atomic commits, and support Create World (fork template) and Join World flows.

**Architecture:** New `src/lib/git/` module with four files (github-client, yaml-loader, repo-writer, journal-formatter). New github store for auth/connection state. New `/login` and `/connect` pages. Existing pages become auth-aware. Octokit handles all GitHub API calls.

**Tech Stack:** Octokit (GitHub API), js-yaml (YAML parsing, already installed), SvelteKit, TypeScript

---

## File Structure

```
New:
  src/lib/git/github-client.ts     — Octokit wrapper: auth, user info, repo CRUD
  src/lib/git/yaml-loader.ts       — Fetch YAML from repo, parse into WorldBlocks/WorldState
  src/lib/git/repo-writer.ts       — Atomic multi-file commits via Git Data API
  src/lib/git/journal-formatter.ts — Format PlaySession into markdown
  src/lib/stores/github.ts         — Auth state, repo connection, sync status
  src/routes/login/+page.svelte    — Auth page (PAT + OAuth placeholder)
  src/routes/connect/+page.svelte  — Repo selection (Create/Join/Continue)
  tools/oauth-worker.js            — Cloudflare Worker for OAuth (not deployed)
  tests/git/github-client.test.ts  — Tests for github client
  tests/git/yaml-loader.test.ts    — Tests for YAML loader
  tests/git/repo-writer.test.ts    — Tests for repo writer
  tests/git/journal-formatter.test.ts — Tests for journal formatter

Modified:
  src/lib/stores/player.ts         — Add GitHub prefs fields
  src/routes/+page.svelte          — Auth-aware landing page
  src/routes/session-end/+page.svelte — GitHub write on save
  src/routes/settings/+page.svelte — GitHub connection section
  package.json                     — Add octokit dependency
```

---

### Task 1: Install Octokit and Update Player Prefs

**Files:**
- Modify: `package.json`
- Modify: `src/lib/stores/player.ts`

- [ ] **Step 1: Install octokit**

```bash
eval "$(direnv export bash 2>/dev/null)" && npm install octokit
```

- [ ] **Step 2: Update PlayerPrefs with GitHub fields**

In `src/lib/stores/player.ts`, add GitHub-related fields to `PlayerPrefs`:

```ts
export interface PlayerPrefs {
	dayTypePreferences: string[];
	llmSetting: 'none' | 'local' | 'claude';
	llmEndpoint?: string;
	llmModel?: string;
	llmApiKey?: string;
	githubToken?: string;
	githubUsername?: string;
	repoOwner?: string;
	repoName?: string;
}
```

- [ ] **Step 3: Verify types compile**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/stores/player.ts
git commit -m "feat: install octokit and add GitHub fields to PlayerPrefs"
```

---

### Task 2: GitHub Store

**Files:**
- Create: `src/lib/stores/github.ts`

- [ ] **Step 1: Create the GitHub store**

```ts
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
	// Don't persist the token in the github state — it's in PlayerPrefs
	const { token, ...rest } = state;
	localStorage.setItem(GH_STATE_KEY, JSON.stringify(rest));
}

export function loadGitHubState(): Partial<GitHubState> {
	if (typeof localStorage === 'undefined') return {};
	const raw = localStorage.getItem(GH_STATE_KEY);
	if (!raw) return {};
	return JSON.parse(raw);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/stores/github.ts
git commit -m "feat: add GitHub store — auth state, repo connection, sync status"
```

---

### Task 3: GitHub Client

**Files:**
- Create: `src/lib/git/github-client.ts`
- Create: `tests/git/github-client.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { validateToken, parseRepoUrl } from '../../src/lib/git/github-client';

describe('parseRepoUrl', () => {
	it('parses a full GitHub URL', () => {
		const result = parseRepoUrl('https://github.com/owner/repo');
		expect(result).toEqual({ owner: 'owner', repo: 'repo' });
	});

	it('parses owner/repo shorthand', () => {
		const result = parseRepoUrl('owner/repo');
		expect(result).toEqual({ owner: 'owner', repo: 'repo' });
	});

	it('strips trailing slashes and .git', () => {
		const result = parseRepoUrl('https://github.com/owner/repo.git/');
		expect(result).toEqual({ owner: 'owner', repo: 'repo' });
	});

	it('returns null for invalid URLs', () => {
		expect(parseRepoUrl('')).toBeNull();
		expect(parseRepoUrl('not-a-url')).toBeNull();
		expect(parseRepoUrl('https://github.com/')).toBeNull();
	});
});
```

- [ ] **Step 2: Implement github-client.ts**

```ts
import { Octokit } from 'octokit';

let octokitInstance: Octokit | null = null;

export function getOctokit(token: string): Octokit {
	if (!octokitInstance || (octokitInstance as any).auth !== token) {
		octokitInstance = new Octokit({ auth: token });
	}
	return octokitInstance;
}

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
	if (!url || !url.trim()) return null;

	let cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');

	// Handle full URL: https://github.com/owner/repo
	const urlMatch = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/);
	if (urlMatch) {
		return { owner: urlMatch[1], repo: urlMatch[2] };
	}

	// Handle shorthand: owner/repo
	const shortMatch = cleaned.match(/^([^/]+)\/([^/]+)$/);
	if (shortMatch) {
		return { owner: shortMatch[1], repo: shortMatch[2] };
	}

	return null;
}

export async function validateToken(token: string): Promise<{ valid: boolean; username: string }> {
	try {
		const octokit = getOctokit(token);
		const { data } = await octokit.rest.users.getAuthenticated();
		return { valid: true, username: data.login };
	} catch {
		return { valid: false, username: '' };
	}
}

export async function validateRepo(token: string, owner: string, repo: string): Promise<{ valid: boolean; canWrite: boolean; error?: string }> {
	try {
		const octokit = getOctokit(token);

		// Check repo exists and get permissions
		const { data: repoData } = await octokit.rest.repos.get({ owner, repo });

		// Check for world.yaml
		try {
			await octokit.rest.repos.getContent({ owner, repo, path: 'world.yaml' });
		} catch {
			return { valid: false, canWrite: false, error: 'No world.yaml found — this doesn\'t look like a Journal RPG world repo' };
		}

		const canWrite = repoData.permissions?.push ?? false;
		return { valid: true, canWrite };
	} catch {
		return { valid: false, canWrite: false, error: 'Repository not found or not accessible' };
	}
}

export async function forkRepo(token: string, templateOwner: string, templateRepo: string): Promise<{ owner: string; repo: string } | null> {
	try {
		const octokit = getOctokit(token);
		const { data } = await octokit.rest.repos.createFork({
			owner: templateOwner,
			repo: templateRepo
		});
		return { owner: data.owner.login, repo: data.name };
	} catch {
		return null;
	}
}

export async function listUserRepos(token: string): Promise<Array<{ owner: string; repo: string; description: string }>> {
	try {
		const octokit = getOctokit(token);
		const { data } = await octokit.rest.repos.listForAuthenticatedUser({
			sort: 'updated',
			per_page: 20
		});
		return data.map(r => ({
			owner: r.owner.login,
			repo: r.name,
			description: r.description ?? ''
		}));
	} catch {
		return [];
	}
}
```

- [ ] **Step 3: Run tests**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/git/github-client.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/git/github-client.ts tests/git/github-client.test.ts
git commit -m "feat: add GitHub client — auth validation, repo parsing, fork, list repos"
```

---

### Task 4: YAML Loader (Read from Repo)

**Files:**
- Create: `src/lib/git/yaml-loader.ts`
- Create: `tests/git/yaml-loader.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseYamlContent, buildWorldBlocksFromFiles, buildWorldStateFromFiles } from '../../src/lib/git/yaml-loader';

describe('parseYamlContent', () => {
	it('parses base64-encoded YAML content', () => {
		const base64 = btoa('name: Test\nvalue: 42');
		const result = parseYamlContent(base64);
		expect(result).toEqual({ name: 'Test', value: 42 });
	});

	it('returns null for invalid content', () => {
		expect(parseYamlContent('')).toBeNull();
	});
});

describe('buildWorldBlocksFromFiles', () => {
	it('builds WorldBlocks from a file map', () => {
		const files = new Map<string, string>();
		files.set('world.yaml', btoa('name: Test World\ndescription: A test\nsetting: medieval\ndateSystem:\n  seasons: [spring, summer]\n  daysPerSeason: 30\n  startYear: 845\nstartingFactions: []\nactiveQuestlines: []\ntheme: {}'));
		files.set('blocks/archetypes/soldier.yaml', btoa('id: soldier\nname: Soldier\ntraits:\n  strength: { min: 5, max: 9 }\nskills: [swordsmanship]\nnamingPatterns: [Aldric]\nactivities: [standing watch]'));

		const blocks = buildWorldBlocksFromFiles(files);
		expect(blocks.config.name).toBe('Test World');
		expect(blocks.archetypes).toHaveLength(1);
		expect(blocks.archetypes[0].id).toBe('soldier');
	});
});
```

- [ ] **Step 2: Implement yaml-loader.ts**

```ts
import yaml from 'js-yaml';
import { getOctokit } from './github-client';
import type { WorldBlocks } from '../../lib/engine/world-loader';
import type { Archetype, EventTemplate, LocationType, Questline, WorldConfig } from '../types/blocks';
import type { WorldState, Character, FactionState, QuestlineProgress, LocationInstance, TimelineEntry } from '../types/state';

export interface RepoFile {
	path: string;
	sha: string;
	content: string; // base64
}

export interface FileCache {
	files: Map<string, { sha: string; content: string }>;
	timestamp: number;
}

const CACHE_KEY = 'journal-rpg-repo-cache';

export function parseYamlContent<T = any>(base64Content: string): T | null {
	try {
		const decoded = atob(base64Content);
		return yaml.load(decoded) as T;
	} catch {
		return null;
	}
}

/**
 * Fetch all YAML files from a repo directory via GitHub API.
 */
export async function fetchRepoFiles(
	token: string,
	owner: string,
	repo: string
): Promise<Map<string, string>> {
	const octokit = getOctokit(token);
	const files = new Map<string, string>();

	// Fetch the full tree recursively
	try {
		const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: 'heads/main' });
		const { data: tree } = await octokit.rest.git.getTree({
			owner, repo,
			tree_sha: ref.object.sha,
			recursive: 'true'
		});

		// Fetch content for each yaml/md file
		const yamlFiles = tree.tree.filter(
			f => f.type === 'blob' && (f.path?.endsWith('.yaml') || f.path?.endsWith('.yml') || f.path?.endsWith('.md') || f.path?.endsWith('.css'))
		);

		for (const file of yamlFiles) {
			if (!file.path || !file.sha) continue;
			try {
				const { data } = await octokit.rest.git.getBlob({ owner, repo, file_sha: file.sha });
				files.set(file.path, data.content);
			} catch {
				// Skip unreadable files
			}
		}
	} catch {
		// If main doesn't exist, try master
		try {
			const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: 'heads/master' });
			const { data: tree } = await octokit.rest.git.getTree({
				owner, repo,
				tree_sha: ref.object.sha,
				recursive: 'true'
			});

			const yamlFiles = tree.tree.filter(
				f => f.type === 'blob' && (f.path?.endsWith('.yaml') || f.path?.endsWith('.yml'))
			);

			for (const file of yamlFiles) {
				if (!file.path || !file.sha) continue;
				try {
					const { data } = await octokit.rest.git.getBlob({ owner, repo, file_sha: file.sha });
					files.set(file.path, data.content);
				} catch {}
			}
		} catch {}
	}

	return files;
}

/**
 * Build WorldBlocks from a map of file paths → base64 content.
 */
export function buildWorldBlocksFromFiles(files: Map<string, string>): WorldBlocks {
	const config = parseYamlContent<WorldConfig>(files.get('world.yaml') ?? '') ?? {
		name: 'Unknown', description: '', setting: 'medieval',
		dateSystem: { seasons: ['spring', 'summer', 'autumn', 'winter'], daysPerSeason: 30, startYear: 845 },
		startingFactions: [], activeQuestlines: [], theme: {}
	};

	const archetypes: Archetype[] = [];
	const events: EventTemplate[] = [];
	const locations: LocationType[] = [];
	const questlines: Questline[] = [];

	for (const [path, content] of files) {
		if (path.startsWith('blocks/archetypes/') && path.endsWith('.yaml')) {
			const parsed = parseYamlContent<Archetype>(content);
			if (parsed) archetypes.push(parsed);
		} else if (path.startsWith('blocks/events/') && path.endsWith('.yaml')) {
			const parsed = parseYamlContent<EventTemplate>(content);
			if (parsed) events.push(parsed);
		} else if (path.startsWith('blocks/locations/') && path.endsWith('.yaml')) {
			const parsed = parseYamlContent<LocationType>(content);
			if (parsed) locations.push(parsed);
		} else if (path.startsWith('blocks/questlines/') && path.endsWith('.yaml')) {
			const parsed = parseYamlContent<Questline>(content);
			if (parsed) questlines.push(parsed);
		}
	}

	return { config, archetypes, events, locations, questlines };
}

/**
 * Build WorldState from repo files. Handles missing state files gracefully.
 */
export function buildWorldStateFromFiles(files: Map<string, string>, config: WorldConfig): WorldState {
	const characters: Character[] = [];
	for (const [path, content] of files) {
		if (path.startsWith('state/characters/') && path.endsWith('.yaml')) {
			const parsed = parseYamlContent<Character>(content);
			if (parsed) characters.push(parsed);
		}
	}

	const timeline = parseYamlContent<TimelineEntry[]>(files.get('state/timeline.yaml') ?? '') ?? [];
	const questlineProgress = parseYamlContent<QuestlineProgress[]>(files.get('state/questline-state.yaml') ?? '') ?? [];
	const factions = parseYamlContent<FactionState[]>(files.get('state/factions.yaml') ?? '') ??
		config.startingFactions.map(f => ({ id: f.id, mood: f.initialMood }));
	const worldFacts = parseYamlContent<Record<string, string | number | boolean>>(files.get('state/world-facts.yaml') ?? '') ?? {};
	const recentEventIds = parseYamlContent<string[]>(files.get('state/recent-events.yaml') ?? '') ?? [];

	// Build location instances from location type blocks if no state exists
	const locations: LocationInstance[] = [];
	for (const [path, content] of files) {
		if (path.startsWith('state/locations/') && path.endsWith('.yaml')) {
			const parsed = parseYamlContent<LocationInstance>(content);
			if (parsed) locations.push(parsed);
		}
	}

	return {
		config,
		characters,
		timeline,
		factions,
		questlineProgress,
		locations,
		playedCharacterIds: [],
		worldFacts,
		recentEventIds
	};
}

/**
 * Save fetched files to localStorage cache.
 */
export function cacheFiles(files: Map<string, string>): void {
	if (typeof localStorage === 'undefined') return;
	const obj: Record<string, string> = {};
	for (const [k, v] of files) obj[k] = v;
	localStorage.setItem(CACHE_KEY, JSON.stringify({ files: obj, timestamp: Date.now() }));
}

/**
 * Load files from localStorage cache.
 */
export function loadCachedFiles(): Map<string, string> | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(CACHE_KEY);
	if (!raw) return null;
	const parsed = JSON.parse(raw);
	if (!parsed.files) return null;
	return new Map(Object.entries(parsed.files));
}
```

- [ ] **Step 3: Run tests**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/git/yaml-loader.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/git/yaml-loader.ts tests/git/yaml-loader.test.ts
git commit -m "feat: add YAML loader — fetch and parse world data from GitHub repos"
```

---

### Task 5: Repo Writer (Atomic Commits)

**Files:**
- Create: `src/lib/git/repo-writer.ts`
- Create: `tests/git/repo-writer.test.ts`

- [ ] **Step 1: Write tests for serialization helpers**

```ts
import { describe, it, expect } from 'vitest';
import { serializeWorldStateToFiles } from '../../src/lib/git/repo-writer';
import { createTestWorldState } from '../fixtures/world-state';

describe('serializeWorldStateToFiles', () => {
	it('serializes world state to a file map', () => {
		const world = createTestWorldState();
		const files = serializeWorldStateToFiles(world);

		expect(files.has('state/timeline.yaml')).toBe(true);
		expect(files.has('state/factions.yaml')).toBe(true);
		expect(files.has('state/questline-state.yaml')).toBe(true);
		expect(files.has('state/world-facts.yaml')).toBe(true);
	});

	it('creates a file per character', () => {
		const world = createTestWorldState();
		const files = serializeWorldStateToFiles(world);

		const charFiles = [...files.keys()].filter(k => k.startsWith('state/characters/'));
		expect(charFiles.length).toBe(2); // elena + marcus
	});
});
```

- [ ] **Step 2: Implement repo-writer.ts**

```ts
import yaml from 'js-yaml';
import { getOctokit } from './github-client';
import type { WorldState } from '../types/state';

/**
 * Serialize world state to a map of file paths → YAML content strings.
 */
export function serializeWorldStateToFiles(state: WorldState): Map<string, string> {
	const files = new Map<string, string>();

	// Characters — one file per character
	for (const char of state.characters) {
		const slug = char.id.replace(/[^a-z0-9_-]/gi, '-');
		files.set(`state/characters/${slug}.yaml`, yaml.dump(char));
	}

	// Timeline
	files.set('state/timeline.yaml', yaml.dump(state.timeline));

	// Questline progress
	files.set('state/questline-state.yaml', yaml.dump(state.questlineProgress));

	// Factions
	files.set('state/factions.yaml', yaml.dump(state.factions));

	// World facts
	files.set('state/world-facts.yaml', yaml.dump(state.worldFacts ?? {}));

	// Recent events
	files.set('state/recent-events.yaml', yaml.dump(state.recentEventIds ?? []));

	return files;
}

/**
 * Commit multiple files atomically to a repo using the Git Data API.
 */
export async function commitFiles(
	token: string,
	owner: string,
	repo: string,
	files: Map<string, string>,
	message: string
): Promise<{ success: boolean; sha?: string; error?: string }> {
	try {
		const octokit = getOctokit(token);

		// 1. Get current ref
		let ref: string;
		try {
			const { data } = await octokit.rest.git.getRef({ owner, repo, ref: 'heads/main' });
			ref = 'heads/main';
		} catch {
			const { data } = await octokit.rest.git.getRef({ owner, repo, ref: 'heads/master' });
			ref = 'heads/master';
		}

		const { data: refData } = await octokit.rest.git.getRef({ owner, repo, ref });
		const currentCommitSha = refData.object.sha;

		// 2. Get current tree
		const { data: commitData } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: currentCommitSha });
		const baseTreeSha = commitData.tree.sha;

		// 3. Create blobs for each file
		const treeItems: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];

		for (const [path, content] of files) {
			const { data: blob } = await octokit.rest.git.createBlob({
				owner, repo,
				content: content,
				encoding: 'utf-8'
			});
			treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
		}

		// 4. Create new tree
		const { data: newTree } = await octokit.rest.git.createTree({
			owner, repo,
			base_tree: baseTreeSha,
			tree: treeItems
		});

		// 5. Create commit
		const { data: newCommit } = await octokit.rest.git.createCommit({
			owner, repo,
			message,
			tree: newTree.sha,
			parents: [currentCommitSha]
		});

		// 6. Update ref
		await octokit.rest.git.updateRef({
			owner, repo,
			ref,
			sha: newCommit.sha
		});

		return { success: true, sha: newCommit.sha };
	} catch (err: any) {
		return { success: false, error: err.message ?? 'Unknown error' };
	}
}

/**
 * Queue pending changes to localStorage for retry.
 */
export function queuePendingChanges(files: Map<string, string>, message: string): void {
	if (typeof localStorage === 'undefined') return;
	const key = 'journal-rpg-pending-changes';
	const existing = JSON.parse(localStorage.getItem(key) ?? '[]');
	const filesObj: Record<string, string> = {};
	for (const [k, v] of files) filesObj[k] = v;
	existing.push({ files: filesObj, message, timestamp: Date.now() });
	localStorage.setItem(key, JSON.stringify(existing));
}

/**
 * Get and clear pending changes from localStorage.
 */
export function getPendingChanges(): Array<{ files: Record<string, string>; message: string }> {
	if (typeof localStorage === 'undefined') return [];
	const key = 'journal-rpg-pending-changes';
	const raw = localStorage.getItem(key);
	if (!raw) return [];
	localStorage.removeItem(key);
	return JSON.parse(raw);
}
```

- [ ] **Step 3: Run tests**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/git/repo-writer.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/git/repo-writer.ts tests/git/repo-writer.test.ts
git commit -m "feat: add repo writer — atomic multi-file commits via Git Data API"
```

---

### Task 6: Journal Formatter

**Files:**
- Create: `src/lib/git/journal-formatter.ts`
- Create: `tests/git/journal-formatter.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest';
import { formatJournalEntry } from '../../src/lib/git/journal-formatter';
import type { PlaySession, ChoiceRecord } from '../../src/lib/types/session';
import type { Character } from '../../src/lib/types/state';

describe('formatJournalEntry', () => {
	it('formats a session into markdown', () => {
		const character: Character = {
			id: 'elena', name: 'Elena', archetypeId: 'blacksmith',
			traits: {}, skills: [], locationId: '', factions: {},
			relationships: {},
			birthDate: { year: 820, season: 'spring', day: 1 },
			deathDate: null, alive: true
		};

		const choiceLog: ChoiceRecord[] = [
			{
				nodeId: 'start', choiceId: 'browse', text: 'Browse the wares',
				narrativeText: 'The market was busy today.',
				consequences: [{ type: 'stat', target: 'cunning', value: 1 }],
				timestamp: 1000
			}
		];

		const result = formatJournalEntry(character, { year: 847, season: 'spring', day: 14 }, choiceLog);

		expect(result).toContain('# Elena the Blacksmith');
		expect(result).toContain('Spring, Day 14, Year 847');
		expect(result).toContain('> Browse the wares');
		expect(result).toContain('cunning');
	});

	it('includes death notice for dead characters', () => {
		const character: Character = {
			id: 'elena', name: 'Elena', archetypeId: 'blacksmith',
			traits: {}, skills: [], locationId: '', factions: {},
			relationships: {},
			birthDate: { year: 820, season: 'spring', day: 1 },
			deathDate: { year: 847, season: 'spring', day: 14 }, alive: false
		};

		const result = formatJournalEntry(character, { year: 847, season: 'spring', day: 14 }, [], true);
		expect(result).toContain('did not survive');
	});
});
```

- [ ] **Step 2: Implement journal-formatter.ts**

```ts
import type { ChoiceRecord } from '../types/session';
import type { Character, GameDate } from '../types/state';

/**
 * Format a play session into a human-readable markdown journal entry.
 */
export function formatJournalEntry(
	character: Character,
	date: GameDate,
	choiceLog: ChoiceRecord[],
	isDead: boolean = false
): string {
	const season = date.season.charAt(0).toUpperCase() + date.season.slice(1);
	const archetype = character.archetypeId.charAt(0).toUpperCase() + character.archetypeId.slice(1);

	let md = `# ${character.name} the ${archetype} — ${season}, Day ${date.day}, Year ${date.year}\n\n`;

	for (const record of choiceLog) {
		if (record.narrativeText) {
			md += `${record.narrativeText}\n\n`;
		}
		md += `> ${record.text}\n\n`;
	}

	if (isDead) {
		md += `---\n\n*${character.name} did not survive the day.*\n\n`;
	}

	// Consequences summary
	const consequences = new Set<string>();
	for (const record of choiceLog) {
		for (const c of record.consequences) {
			if (c.type === 'stat') {
				const dir = typeof c.value === 'number' && c.value > 0 ? '+' : '';
				consequences.add(`${c.target} ${dir}${c.value}`);
			} else if (c.type === 'faction') {
				consequences.add(`${c.target} reputation changed`);
			} else if (c.type === 'world_fact') {
				consequences.add(`World fact: ${c.target}`);
			} else if (c.type === 'relationship') {
				consequences.add(`Relationship changed`);
			}
		}
	}

	if (consequences.size > 0) {
		md += `---\n**Consequences:** ${[...consequences].join(', ')}\n`;
	}

	return md;
}

/**
 * Generate the file path for a journal entry.
 */
export function journalFilePath(character: Character, date: GameDate): string {
	const slug = character.id.replace(/[^a-z0-9_-]/gi, '-');
	const dateStr = `${String(date.year).padStart(4, '0')}-${date.season}-${String(date.day).padStart(2, '0')}`;
	return `journals/${slug}/${dateStr}.md`;
}
```

- [ ] **Step 3: Run tests**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/git/journal-formatter.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/git/journal-formatter.ts tests/git/journal-formatter.test.ts
git commit -m "feat: add journal formatter — format play sessions as markdown for GitHub"
```

---

### Task 7: Login Page

**Files:**
- Create: `src/routes/login/+page.svelte`

- [ ] **Step 1: Create the login page**

The login page offers three paths:
1. **PAT login** — text input for token, "Connect" button, validates via `validateToken`
2. **OAuth placeholder** — "Login with GitHub" button, disabled with note "Requires OAuth worker setup"  
3. **Play Offline** — link to `/?offline=true`

On successful PAT auth:
- Store token in PlayerPrefs via `savePlayerPrefs`
- Update `githubState` store
- Navigate to `/connect`

Handle the OAuth callback: check for `?token=` URL param on mount (from the OAuth worker redirect). If present, validate and store it.

Use the dark session-end aesthetic. Svelte 5 syntax.

Imports needed:
```ts
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { validateToken } from '$lib/git/github-client';
import { playerPrefs, savePlayerPrefs, loadPlayerPrefs } from '$lib/stores/player';
import { githubState, saveGitHubState } from '$lib/stores/github';
import { onMount } from 'svelte';
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/login/+page.svelte
git commit -m "feat: add login page — PAT auth with OAuth placeholder"
```

---

### Task 8: Connect Page (Repo Selection)

**Files:**
- Create: `src/routes/connect/+page.svelte`

- [ ] **Step 1: Create the connect page**

Three sections:
1. **Create World** — button that calls `forkRepo` with the template repo owner/name (hardcoded for now, e.g., `journal-rpg/ironhaven`). Shows a loading state. On success, connects to the new fork.
2. **Join World** — text input for repo URL, "Connect" button. Parses URL via `parseRepoUrl`, validates via `validateRepo`. Shows error if invalid.
3. **Recent Worlds** — load from localStorage (`PlayerPrefs.repoOwner/repoName`), show as clickable cards.

On successful connection:
- Call `fetchRepoFiles` to load the world
- Parse into WorldBlocks + WorldState via `buildWorldBlocksFromFiles` and `buildWorldStateFromFiles`
- Set the stores: `worldBlocks`, `worldState`
- Save to localStorage cache
- Update `githubState` with connected repo
- Save to `PlayerPrefs`
- Navigate to `/journal/setup`

Show the logged-in username at top. Include "Logout" link.

Use the dark aesthetic. Svelte 5 syntax.

Imports needed:
```ts
import { goto } from '$app/navigation';
import { worldState, worldBlocks } from '$lib/stores/world';
import { githubState, saveGitHubState } from '$lib/stores/github';
import { playerPrefs, savePlayerPrefs, loadPlayerPrefs } from '$lib/stores/player';
import { parseRepoUrl, validateRepo, forkRepo, listUserRepos } from '$lib/git/github-client';
import { fetchRepoFiles, buildWorldBlocksFromFiles, buildWorldStateFromFiles, cacheFiles } from '$lib/git/yaml-loader';
import { initializeWorldState, saveWorldState, saveWorldBlocks } from '$lib/engine/world-loader';
import { onMount } from 'svelte';
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/connect/+page.svelte
git commit -m "feat: add connect page — create world (fork), join world, recent worlds"
```

---

### Task 9: Update Landing Page and Session-End (Auth-Aware)

**Files:**
- Modify: `src/routes/+page.svelte`
- Modify: `src/routes/session-end/+page.svelte`

- [ ] **Step 1: Update landing page**

The landing page becomes auth-aware:
- On mount, check if player has a `githubToken` in prefs
- If authenticated + has repo → show "Continue World" button (loads from GitHub), "Settings", "World Inspector"
- If authenticated but no repo → redirect to `/connect`
- If not authenticated → show "Login" button (→ `/login`) and "Play Offline" button (keeps existing localStorage flow)
- Keep the existing `getDemoWorldBlocks()` and `startNewWorld()` for the offline path

The key change: "Start New World" only appears in offline mode. For GitHub users, world creation happens on `/connect`.

- [ ] **Step 2: Update session-end save handler**

In `handleSave`, after creating the timeline entry and updating world state:
- Check if GitHub is connected (`$githubState.isConnected`)
- If connected: call `serializeWorldStateToFiles` + `commitFiles` + write journal markdown via `formatJournalEntry`/`journalFilePath`
- Show sync status (syncing → synced or error)
- If commit fails: call `queuePendingChanges`, show "pending" status
- Always save to localStorage as well (local cache)

New imports needed:
```ts
import { githubState } from '$lib/stores/github';
import { serializeWorldStateToFiles, commitFiles, queuePendingChanges } from '$lib/git/repo-writer';
import { formatJournalEntry, journalFilePath } from '$lib/git/journal-formatter';
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte src/routes/session-end/+page.svelte
git commit -m "feat: make landing page auth-aware, add GitHub write to session-end save"
```

---

### Task 10: Update Settings Page and OAuth Worker

**Files:**
- Modify: `src/routes/settings/+page.svelte`
- Create: `tools/oauth-worker.js`

- [ ] **Step 1: Add GitHub section to settings page**

Add a new section below the LLM settings:

```
## GitHub Connection
- Username: {username}
- Connected repo: {owner}/{repo}
- Sync status: {synced/pending/error}
- [Sync Now] button — retries pending changes
- [Disconnect] button — clears token and repo from prefs
```

Import `githubState` and show the connection details. The "Sync Now" button calls `getPendingChanges` + `commitFiles` for each batch. "Disconnect" clears GitHub fields from PlayerPrefs and resets the github store.

- [ ] **Step 2: Create OAuth worker file**

Create `tools/oauth-worker.js`:

```js
// Minimal OAuth token exchange worker for GitHub
// Deploy to Cloudflare Workers
// Set environment secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, APP_URL
//
// Usage:
// 1. Create a GitHub OAuth App at https://github.com/settings/developers
// 2. Set the callback URL to: https://your-worker.workers.dev/callback
// 3. Deploy this worker: wrangler deploy
// 4. Set the worker URL in your game's login page

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === '/callback') {
			const code = url.searchParams.get('code');
			if (!code) {
				return new Response('Missing code parameter', { status: 400 });
			}

			const response = await fetch('https://github.com/login/oauth/access_token', {
				method: 'POST',
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					client_id: env.GITHUB_CLIENT_ID,
					client_secret: env.GITHUB_CLIENT_SECRET,
					code
				})
			});

			const data = await response.json();

			if (data.access_token) {
				return Response.redirect(
					`${env.APP_URL}/login?token=${data.access_token}`,
					302
				);
			}

			return Response.redirect(
				`${env.APP_URL}/login?error=${encodeURIComponent(data.error_description || 'Authentication failed')}`,
				302
			);
		}

		return new Response('Not found', { status: 404 });
	}
};
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/settings/+page.svelte tools/oauth-worker.js
git commit -m "feat: add GitHub section to settings page and OAuth worker template"
```

---

### Task 11: Integration Check

- [ ] **Step 1: Run full test suite**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Type check**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Build static site**

```bash
eval "$(direnv export bash 2>/dev/null)" && npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test**

```bash
eval "$(direnv export bash 2>/dev/null)" && npm run dev -- --port 5173
```

Verify:
- Landing page shows "Login" and "Play Offline" for unauthenticated users
- "Play Offline" still works (existing localStorage flow)
- `/login` page loads with PAT input
- Enter a valid PAT → validates → navigates to `/connect`
- `/connect` shows Create World / Join World
- Enter a valid repo URL → validates → loads world from YAML
- Play a session → save → check GitHub repo for new commits
- Settings page shows GitHub connection info

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: integration check — all tests, types, and build pass"
```
