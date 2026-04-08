/** A character template — "blacksmith", "merchant", "deserter" */
export interface Archetype {
	id: string;
	name: string;
	traits: Record<string, TraitRange>;
	skills: string[];
	namingPatterns: string[];
	factions?: string[];
	locations?: string[];
	activities: string[];
}

export interface TraitRange {
	min: number;
	max: number;
}

/** A role that an event needs filled — resolved via waveform collapse */
export interface Role {
	id: string;
	label: string;
	archetypeFilter?: string[];
	traitRequirements?: Record<string, { min?: number; max?: number }>;
	factionRequirements?: string[];
}

/** A single choice node in an event's branching narrative */
export interface ChoiceNode {
	id: string;
	text: string;
	choices: Choice[];
}

export interface Choice {
	id: string;
	label: string;
	preconditions?: ChoicePrecondition[];
	consequences: Consequence[];
	exhaustionCost: number;
	nextNodeId: string | null;
}

export interface ChoicePrecondition {
	type: 'trait' | 'skill' | 'item' | 'faction';
	key: string;
	min?: number;
}

export interface Consequence {
	type: 'stat' | 'faction' | 'questline' | 'world_fact' | 'relationship' | 'relationship_tag' | 'death' | 'exhaustion';
	target: string;
	value: number | string | boolean;
	axis?: string;
}

import type { EscalationConfig } from './storyline';

/** A thing that can happen — "bandit raid", "harvest festival" */
export interface EventTemplate {
	id: string;
	name: string;
	tags: string[];
	preconditions: EventPrecondition[];
	roles: Role[];
	entryNodeId: string;
	nodes: Record<string, ChoiceNode>;
	storyline?: string;
	chapter?: number;
	reentry_recap?: string;
	escalation?: EscalationConfig;
}

export interface EventPrecondition {
	type: 'questline_stage' | 'season' | 'location_type' | 'faction_mood' | 'tag' | 'relationship_axis' | 'relationship_tag' | 'world_fact' | 'archetype' | 'skill';
	key: string;
	value: string | number | boolean;
	operator?: 'eq' | 'gte' | 'lte' | 'in';
}

/** A place — "tavern", "crossroads shrine", "mine entrance" */
export interface LocationType {
	id: string;
	name: string;
	tags: string[];
	eventTags: string[];
	archetypeIds: string[];
	flavorTexts: string[];
	natural?: boolean;
}

/** A questline stage */
export interface QuestlineStage {
	id: string;
	name: string;
	description: string;
	worldConditions: Record<string, string | number | boolean>;
	advancementTriggers: Trigger[];
	regressionTriggers: Trigger[];
	flavorShifts: Record<string, string>;
}

export interface Trigger {
	type: 'counter' | 'event' | 'time';
	key: string;
	threshold: number;
}

/** A macro narrative arc */
export interface Questline {
	id: string;
	name: string;
	description: string;
	stages: QuestlineStage[];
}

/** Top-level world configuration */
export interface WorldConfig {
	name: string;
	description: string;
	setting: string;
	dateSystem: DateSystem;
	startingFactions: FactionDef[];
	activeQuestlines: string[];
	theme: ThemeConfig;
}

export interface DateSystem {
	seasons: string[];
	daysPerSeason: number;
	startYear: number;
}

export interface FactionDef {
	id: string;
	name: string;
	description: string;
	initialMood: number;
}

export interface ThemeConfig {
	backgroundImage?: string;
	styleSheet?: string;
	fontFamily?: string;
}
