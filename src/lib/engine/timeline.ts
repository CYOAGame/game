import type { Questline, DateSystem } from '../types/blocks';
import type { WorldState, GameDate, Character } from '../types/state';
import { compareDates, dateToDays, daysToDate } from '../types/state';

export interface CharacterSuggestion {
	type: 'existing' | 'new';
	characterId?: string;
	characterName?: string;
	archetypeId?: string;
	contextLine: string;
}

export function createWorldSnapshotAt(
	worldState: WorldState,
	targetDate: GameDate,
	questlines: Questline[]
): WorldState {
	const seasonOrder = worldState.config.dateSystem.seasons;

	const characters = worldState.characters.filter(c => {
		const bornBefore = compareDates(c.birthDate, targetDate, seasonOrder) <= 0;
		if (!bornBefore) return false;
		if (c.deathDate) {
			const deadBefore = compareDates(c.deathDate, targetDate, seasonOrder) <= 0;
			if (deadBefore) return false;
		}
		return true;
	});

	const locations = worldState.locations.filter(l => {
		const builtBefore = compareDates(l.builtDate, targetDate, seasonOrder) <= 0;
		if (!builtBefore) return false;
		if (l.destroyedDate) {
			const destroyedBefore = compareDates(l.destroyedDate, targetDate, seasonOrder) <= 0;
			if (destroyedBefore) return false;
		}
		return true;
	});

	const timeline = worldState.timeline.filter(
		e => compareDates(e.date, targetDate, seasonOrder) <= 0
	);

	const questlineProgress = worldState.questlineProgress.map(progress => {
		const latestTimelineDate = worldState.timeline.length > 0
			? worldState.timeline[worldState.timeline.length - 1].date
			: null;
		if (latestTimelineDate && compareDates(targetDate, latestTimelineDate, seasonOrder) >= 0) {
			return { ...progress };
		}
		return { ...progress, currentStageIndex: 0, counters: {} };
	});

	const factions = worldState.config.startingFactions.map(f => {
		let mood = f.initialMood;
		for (const entry of timeline) {
			for (const consequence of entry.consequences) {
				if (consequence.type === 'faction' && consequence.target === f.id && typeof consequence.value === 'number') {
					mood += consequence.value;
				}
			}
		}
		return { id: f.id, mood };
	});

	return {
		config: worldState.config,
		characters,
		timeline,
		factions,
		questlineProgress,
		locations,
		playedCharacterIds: [...worldState.playedCharacterIds],
		recentEventIds: [...(worldState.recentEventIds ?? [])],
		worldFacts: { ...(worldState.worldFacts ?? {}) },
		storylineStates: { ...(worldState.storylineStates ?? {}) }
	};
}

export function generatePastDate(
	character: Character,
	currentDate: GameDate,
	dateSystem: DateSystem,
	timeline?: WorldState['timeline']
): GameDate {
	const { seasons, daysPerSeason } = dateSystem;
	const startDays = dateToDays(character.birthDate, seasons, daysPerSeason);
	const endDays = dateToDays(currentDate, seasons, daysPerSeason) - 1;
	if (endDays <= startDays) return character.birthDate;
	return weightedRandomDate(startDays, endDays, seasons, daysPerSeason, timeline);
}

export function generateFutureDate(
	character: Character,
	currentDate: GameDate,
	dateSystem: DateSystem,
	timeline?: WorldState['timeline'],
	maxYearsAhead: number = 20
): GameDate | null {
	if (!character.alive) return null;
	const { seasons, daysPerSeason } = dateSystem;
	const startDays = dateToDays(currentDate, seasons, daysPerSeason) + 1;
	const endDays = startDays + maxYearsAhead * seasons.length * daysPerSeason;
	return weightedRandomDate(startDays, endDays, seasons, daysPerSeason, timeline);
}

function weightedRandomDate(
	startDays: number,
	endDays: number,
	seasonOrder: string[],
	daysPerSeason: number,
	timeline?: WorldState['timeline']
): GameDate {
	const range = endDays - startDays;
	if (range <= 0) return daysToDate(startDays, seasonOrder, daysPerSeason);

	const timelineDays = new Set<number>();
	if (timeline) {
		for (const entry of timeline) {
			timelineDays.add(dateToDays(entry.date, seasonOrder, daysPerSeason));
		}
	}

	let bestDay = startDays + Math.floor(Math.random() * range);
	let bestWeight = 1;

	for (let attempt = 0; attempt < 10; attempt++) {
		const candidateDay = startDays + Math.floor(Math.random() * range);
		let weight = 1;
		for (const tDay of timelineDays) {
			const distance = Math.abs(candidateDay - tDay);
			if (distance <= 5) weight *= 3;
			else if (distance <= 15) weight *= 1.5;
		}
		if (weight > bestWeight || (weight === bestWeight && Math.random() > 0.5)) {
			bestDay = candidateDay;
			bestWeight = weight;
		}
	}

	return daysToDate(bestDay, seasonOrder, daysPerSeason);
}

export function suggestCharacters(
	currentCharacterId: string,
	worldState: WorldState,
	playedCharacterIds: string[]
): CharacterSuggestion[] {
	const suggestions: CharacterSuggestion[] = [];
	const usedIds = new Set<string>([currentCharacterId]);

	// 1. Relationship extreme
	const relSuggestion = findRelationshipExtreme(worldState, playedCharacterIds, usedIds);
	if (relSuggestion) {
		suggestions.push(relSuggestion);
		usedIds.add(relSuggestion.characterId!);
	}

	// 2. Family or situational
	const famSuggestion = findFamilyOrSituational(worldState, playedCharacterIds, usedIds);
	if (famSuggestion) {
		suggestions.push(famSuggestion);
		usedIds.add(famSuggestion.characterId!);
	}

	// Fill remaining slots up to 2 existing suggestions
	while (suggestions.length < 2) {
		const candidate = worldState.characters.find(c => c.alive && !usedIds.has(c.id));
		if (candidate) {
			suggestions.push({
				type: 'existing',
				characterId: candidate.id,
				characterName: candidate.name,
				archetypeId: candidate.archetypeId,
				contextLine: `A ${candidate.archetypeId} in the area`
			});
			usedIds.add(candidate.id);
		} else {
			break;
		}
	}

	// 3. Always: Someone New — pad with extra new slots if still under 3
	while (suggestions.length < 2) {
		suggestions.push({ type: 'new', contextLine: 'A stranger arrives' });
	}
	suggestions.push({ type: 'new', contextLine: 'A stranger in troubled times' });

	return suggestions;
}

function findRelationshipExtreme(
	worldState: WorldState,
	playedCharacterIds: string[],
	excludeIds: Set<string>
): CharacterSuggestion | null {
	let bestChar: Character | null = null;
	let bestValue = 0;
	let bestAxis = '';

	for (const playedId of playedCharacterIds) {
		const played = worldState.characters.find(c => c.id === playedId);
		if (!played) continue;
		for (const [targetId, relationship] of Object.entries(played.relationships)) {
			if (excludeIds.has(targetId)) continue;
			const target = worldState.characters.find(c => c.id === targetId && c.alive);
			if (!target) continue;
			for (const [axis, value] of Object.entries(relationship.axes)) {
				if (Math.abs(value) > bestValue) {
					bestValue = Math.abs(value);
					bestChar = target;
					bestAxis = axis;
				}
			}
		}
	}

	if (!bestChar) return null;
	const descriptor = bestValue > 0 ? `Strong ${bestAxis} bond` : `Deep ${bestAxis} tension`;
	return {
		type: 'existing',
		characterId: bestChar.id,
		characterName: bestChar.name,
		archetypeId: bestChar.archetypeId,
		contextLine: `${descriptor} with a character you've played`
	};
}

function findFamilyOrSituational(
	worldState: WorldState,
	playedCharacterIds: string[],
	excludeIds: Set<string>
): CharacterSuggestion | null {
	for (const char of worldState.characters) {
		if (!char.alive || excludeIds.has(char.id)) continue;
		for (const playedId of playedCharacterIds) {
			const relationship = char.relationships[playedId];
			if (!relationship) continue;
			const familyTag = relationship.tags.find(t => t.startsWith('family:'));
			if (familyTag) {
				const played = worldState.characters.find(c => c.id === playedId);
				return {
					type: 'existing',
					characterId: char.id,
					characterName: char.name,
					archetypeId: char.archetypeId,
					contextLine: `${familyTag.replace('family:', '')} of ${played?.name ?? 'a character you played'}`
				};
			}
		}
	}

	for (const char of worldState.characters) {
		if (!char.alive || excludeIds.has(char.id)) continue;
		return {
			type: 'existing',
			characterId: char.id,
			characterName: char.name,
			archetypeId: char.archetypeId,
			contextLine: `A ${char.archetypeId} elsewhere in the world`
		};
	}

	return null;
}
