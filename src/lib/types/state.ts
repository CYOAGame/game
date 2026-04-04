/** A collapsed (real) character living in the world */
export interface Character {
	id: string;
	name: string;
	archetypeId: string;
	traits: Record<string, number>;
	skills: string[];
	locationId: string;
	factions: Record<string, number>;
	relationships: Record<string, number>;
	birthDate: GameDate;
	deathDate: GameDate | null;
	alive: boolean;
}

export interface GameDate {
	year: number;
	season: string;
	day: number;
}

export function compareDates(a: GameDate, b: GameDate): number {
	if (a.year !== b.year) return a.year - b.year;
	if (a.season !== b.season) return 0;
	return a.day - b.day;
}

export interface TimelineEntry {
	id: string;
	date: GameDate;
	characterId: string;
	eventTemplateId: string;
	choicesMade: string[];
	consequences: Array<{ type: string; target: string; value: number | string | boolean }>;
	summary: string;
}

export interface FactionState {
	id: string;
	mood: number;
}

export interface QuestlineProgress {
	questlineId: string;
	currentStageIndex: number;
	counters: Record<string, number>;
}

export interface WorldState {
	config: import('./blocks').WorldConfig;
	characters: Character[];
	timeline: TimelineEntry[];
	factions: FactionState[];
	questlineProgress: QuestlineProgress[];
	locations: LocationInstance[];
}

export interface LocationInstance {
	id: string;
	typeId: string;
	name: string;
}
