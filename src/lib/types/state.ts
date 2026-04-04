/** Vector-based relationship between two characters */
export interface Relationship {
	tags: string[];
	axes: Record<string, number>;
}

/** A collapsed (real) character living in the world */
export interface Character {
	id: string;
	name: string;
	archetypeId: string;
	traits: Record<string, number>;
	skills: string[];
	locationId: string;
	factions: Record<string, number>;
	relationships: Record<string, Relationship>;
	parentId?: string;
	birthDate: GameDate;
	deathDate: GameDate | null;
	alive: boolean;
}

export interface GameDate {
	year: number;
	season: string;
	day: number;
}

export function compareDates(a: GameDate, b: GameDate, seasonOrder?: string[]): number {
	if (a.year !== b.year) return a.year - b.year;
	if (a.season !== b.season) {
		if (!seasonOrder) return 0;
		return seasonOrder.indexOf(a.season) - seasonOrder.indexOf(b.season);
	}
	return a.day - b.day;
}

export function dateToDays(date: GameDate, seasonOrder: string[], daysPerSeason: number): number {
	const seasonIndex = seasonOrder.indexOf(date.season);
	return date.year * seasonOrder.length * daysPerSeason + seasonIndex * daysPerSeason + date.day;
}

export function daysToDate(days: number, seasonOrder: string[], daysPerSeason: number): GameDate {
	const totalDaysPerYear = seasonOrder.length * daysPerSeason;
	const year = Math.floor(days / totalDaysPerYear);
	const remainder = days - year * totalDaysPerYear;
	const seasonIndex = Math.floor(remainder / daysPerSeason);
	const day = remainder - seasonIndex * daysPerSeason;
	return { year, season: seasonOrder[seasonIndex] ?? seasonOrder[0], day: Math.max(1, day) };
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
	playedCharacterIds: string[];
}

export interface LocationInstance {
	id: string;
	typeId: string;
	name: string;
	builtDate: GameDate;
	destroyedDate?: GameDate;
}
