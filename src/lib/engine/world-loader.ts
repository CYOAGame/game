import yaml from 'js-yaml';
import type { Archetype, EventTemplate, LocationType, Questline, WorldConfig } from '../types/blocks';
import type { WorldState, FactionState, QuestlineProgress, LocationInstance } from '../types/state';

export interface WorldBlocks {
	config: WorldConfig;
	archetypes: Archetype[];
	events: EventTemplate[];
	locations: LocationType[];
	questlines: Questline[];
}

export function parseYaml<T>(yamlString: string): T {
	return yaml.load(yamlString) as T;
}

export function initializeWorldState(blocks: WorldBlocks): WorldState {
	const factions: FactionState[] = blocks.config.startingFactions.map(f => ({
		id: f.id,
		mood: f.initialMood
	}));

	const questlineProgress: QuestlineProgress[] = blocks.questlines
		.filter(q => blocks.config.activeQuestlines.includes(q.id))
		.map(q => ({
			questlineId: q.id,
			currentStageIndex: 0,
			counters: {}
		}));

	const locations: LocationInstance[] = blocks.locations.map(lt => ({
		id: lt.id,
		typeId: lt.id,
		name: lt.name
	}));

	return {
		config: blocks.config,
		characters: [],
		timeline: [],
		factions,
		questlineProgress,
		locations
	};
}

const STORAGE_KEY = 'journal-rpg-world-state';
const BLOCKS_KEY = 'journal-rpg-world-blocks';

export function saveWorldState(state: WorldState): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadWorldState(): WorldState | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	return JSON.parse(raw) as WorldState;
}

export function saveWorldBlocks(blocks: WorldBlocks): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(BLOCKS_KEY, JSON.stringify(blocks));
}

export function loadWorldBlocks(): WorldBlocks | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(BLOCKS_KEY);
	if (!raw) return null;
	return JSON.parse(raw) as WorldBlocks;
}
