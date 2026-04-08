import yaml from 'js-yaml';
import type { Archetype, EventTemplate, LocationType, Questline, WorldConfig } from '../types/blocks';
import type { WorldState, Character, FactionState, QuestlineProgress, LocationInstance, TimelineEntry } from '../types/state';
import type { WorldBlocks } from '../engine/world-loader';
import { getOctokit } from './github-client';

const CACHE_KEY = 'journal-rpg-repo-files';

export function parseYamlContent<T>(base64Content: string): T | null {
	if (!base64Content) return null;
	try {
		const cleaned = base64Content.replace(/\s/g, '');
		// Use TextDecoder for proper UTF-8 handling (atob only does Latin-1)
		const bytes = Uint8Array.from(atob(cleaned), c => c.charCodeAt(0));
		const decoded = new TextDecoder('utf-8').decode(bytes);
		const parsed = yaml.load(decoded);
		if (parsed === null || parsed === undefined) return null;
		return parsed as T;
	} catch (err) {
		console.warn('[parseYaml] Failed to parse content:', err, 'preview:', base64Content.slice(0, 50));
		return null;
	}
}

async function getTreeSha(octokit: ReturnType<typeof getOctokit>, owner: string, repo: string): Promise<string | null> {
	for (const branch of ['heads/main', 'heads/master']) {
		try {
			const { data } = await octokit.rest.git.getRef({ owner, repo, ref: branch });
			return data.object.sha;
		} catch {
			// try next branch
		}
	}
	return null;
}

export async function fetchRepoFiles(token: string, owner: string, repo: string): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	try {
		const octokit = getOctokit(token);
		const refSha = await getTreeSha(octokit, owner, repo);
		if (!refSha) return files;

		// Get commit to find tree sha
		const { data: commitData } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: refSha });
		const treeSha = commitData.tree.sha;

		// Get full recursive tree
		const { data: treeData } = await octokit.rest.git.getTree({ owner, repo, tree_sha: treeSha, recursive: '1' });

		// Filter YAML files
		const yamlItems = (treeData.tree ?? []).filter(
			item => item.type === 'blob' && item.path && /\.(yaml|yml)$/i.test(item.path)
		);

		// Fetch blobs in batches to avoid API throttling
		const BATCH_SIZE = 10;
		for (let i = 0; i < yamlItems.length; i += BATCH_SIZE) {
			const batch = yamlItems.slice(i, i + BATCH_SIZE);
			await Promise.all(
				batch.map(async item => {
					if (!item.path || !item.sha) return;
					try {
						const { data: blob } = await octokit.rest.git.getBlob({ owner, repo, file_sha: item.sha });
						files.set(item.path, blob.content);
					} catch (err) {
						console.warn(`Failed to fetch ${item.path}:`, err);
					}
				})
			);
		}
	} catch {
		// return whatever we have
	}
	return files;
}

export function buildWorldBlocksFromFiles(files: Map<string, string>): WorldBlocks {
	const archetypes: Archetype[] = [];
	const events: EventTemplate[] = [];
	const locations: LocationType[] = [];
	const questlines: Questline[] = [];
	let config: WorldConfig | null = null;

	for (const [path, content] of files) {
		if (path === 'world.yaml') {
			config = parseYamlContent<WorldConfig>(content);
		} else if (path.startsWith('blocks/archetypes/')) {
			const parsed = parseYamlContent<Archetype>(content);
			if (parsed) archetypes.push(parsed);
		} else if (path.startsWith('blocks/events/')) {
			const parsed = parseYamlContent<EventTemplate>(content);
			if (parsed) {
				events.push(parsed);
			} else {
				console.warn(`[WorldBlocks] Failed to parse event: ${path}`);
			}
		} else if (path.startsWith('blocks/locations/')) {
			const parsed = parseYamlContent<LocationType>(content);
			if (parsed) locations.push(parsed);
		} else if (path.startsWith('blocks/questlines/')) {
			const parsed = parseYamlContent<Questline>(content);
			if (parsed) questlines.push(parsed);
		}
	}

	if (!config) {
		throw new Error('No world.yaml found in repository');
	}

	console.log(`[WorldBlocks] Loaded: ${events.length} events, ${archetypes.length} archetypes, ${locations.length} locations, ${questlines.length} questlines`);
	return { config, archetypes, events, locations, questlines };
}

export function buildWorldStateFromFiles(files: Map<string, string>, config: WorldConfig): WorldState {
	const characters: Character[] = [];
	const timeline: TimelineEntry[] = [];
	let factions: FactionState[] = [];
	let questlineProgress: QuestlineProgress[] = [];
	let locations: LocationInstance[] = [];
	let worldFacts: Record<string, string | number | boolean> = {};
	let playedCharacterIds: string[] = [];
	let recentEventIds: string[] = [];
	let storylineStates: Record<string, import('../types/storyline').StorylineState> = {};

	for (const [path, content] of files) {
		if (path.startsWith('state/characters/')) {
			const parsed = parseYamlContent<Character>(content);
			if (parsed) characters.push(parsed);
		} else if (path === 'state/timeline.yaml') {
			const parsed = parseYamlContent<TimelineEntry[]>(content);
			if (Array.isArray(parsed)) timeline.push(...parsed);
		} else if (path === 'state/factions.yaml') {
			const parsed = parseYamlContent<FactionState[]>(content);
			if (Array.isArray(parsed)) factions = parsed;
		} else if (path === 'state/questline-state.yaml') {
			const parsed = parseYamlContent<QuestlineProgress[]>(content);
			if (Array.isArray(parsed)) questlineProgress = parsed;
		} else if (path === 'state/locations.yaml') {
			const parsed = parseYamlContent<LocationInstance[]>(content);
			if (Array.isArray(parsed)) locations = parsed;
		} else if (path === 'state/world-facts.yaml') {
			const parsed = parseYamlContent<Record<string, string | number | boolean>>(content);
			if (parsed && typeof parsed === 'object') worldFacts = parsed;
		} else if (path === 'state/played-characters.yaml') {
			const parsed = parseYamlContent<string[]>(content);
			if (Array.isArray(parsed)) playedCharacterIds = parsed;
		} else if (path === 'state/recent-events.yaml') {
			const parsed = parseYamlContent<string[]>(content);
			if (Array.isArray(parsed)) recentEventIds = parsed;
		}
	}

	return {
		config,
		characters,
		timeline,
		factions,
		questlineProgress,
		locations,
		playedCharacterIds,
		recentEventIds,
		worldFacts,
		storylineStates
	};
}

export function cacheFiles(files: Map<string, string>): void {
	if (typeof localStorage === 'undefined') return;
	const obj: Record<string, string> = {};
	for (const [k, v] of files) {
		obj[k] = v;
	}
	localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
}

export function loadCachedFiles(): Map<string, string> | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(CACHE_KEY);
	if (!raw) return null;
	try {
		const obj = JSON.parse(raw) as Record<string, string>;
		return new Map(Object.entries(obj));
	} catch {
		return null;
	}
}
