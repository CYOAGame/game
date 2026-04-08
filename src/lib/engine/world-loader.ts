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
		name: lt.name,
		builtDate: { year: blocks.config.dateSystem.startYear, season: blocks.config.dateSystem.seasons[0], day: 1 }
	}));

	return {
		config: blocks.config,
		characters: [],
		timeline: [],
		factions,
		questlineProgress,
		locations,
		playedCharacterIds: [],
		recentEventIds: [],
		worldFacts: {},
		storylineStates: {}
	};
}

const STORAGE_KEY = 'journal-rpg-world-state';
const BLOCKS_KEY = 'journal-rpg-world-blocks';

export function saveWorldState(state: WorldState): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function migrateRelationships(character: any): void {
	if (!character.relationships) return;
	for (const [targetId, value] of Object.entries(character.relationships)) {
		if (typeof value === 'number') {
			character.relationships[targetId] = {
				tags: [],
				axes: { affection: value }
			};
		}
	}
}

function migrateLocation(location: any, startYear: number): void {
	if (!location.builtDate) {
		location.builtDate = { year: startYear, season: 'spring', day: 1 };
	}
}

export function loadWorldState(): WorldState | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	const state = JSON.parse(raw) as WorldState;

	// Migrate old formats
	for (const character of state.characters) {
		migrateRelationships(character);
	}
	const startYear = state.config?.dateSystem?.startYear ?? 845;
	for (const location of state.locations) {
		migrateLocation(location, startYear);
	}
	if (!state.playedCharacterIds) {
		(state as any).playedCharacterIds = [];
	}
	if (!state.recentEventIds) {
		(state as any).recentEventIds = [];
	}
	if (!state.worldFacts) {
		(state as any).worldFacts = {};
	}
	if (!state.storylineStates) {
		(state as any).storylineStates = {};
	}

	return state;
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
