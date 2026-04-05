import type { EventTemplate, EventPrecondition, Questline } from '../types/blocks';
import type { WorldState } from '../types/state';

function checkPrecondition(
	precondition: EventPrecondition,
	world: WorldState,
	currentSeason: string,
	questlines: Questline[],
	characterId?: string
): boolean {
	switch (precondition.type) {
		case 'season':
			return currentSeason === precondition.value;

		case 'questline_stage': {
			const questlineId = precondition.key;
			const progress = world.questlineProgress.find(q => q.questlineId === questlineId);
			if (!progress) return false;

			const questline = questlines.find(q => q.id === questlineId);
			if (!questline) return false;

			const requiredStageIndex = questline.stages.findIndex(s => s.id === precondition.value);
			if (requiredStageIndex === -1) return false;

			const op = precondition.operator ?? 'gte';
			if (op === 'gte') return progress.currentStageIndex >= requiredStageIndex;
			if (op === 'lte') return progress.currentStageIndex <= requiredStageIndex;
			return progress.currentStageIndex === requiredStageIndex;
		}

		case 'faction_mood': {
			const faction = world.factions.find(f => f.id === precondition.key);
			if (!faction) return false;
			const op = precondition.operator ?? 'gte';
			if (op === 'gte') return faction.mood >= (precondition.value as number);
			if (op === 'lte') return faction.mood <= (precondition.value as number);
			return faction.mood === precondition.value;
		}

		case 'relationship_axis': {
			// key = axis name (e.g. 'trust'), value = threshold
			// Checks if ANY character has this axis value with the player character
			const char = world.characters.find(c => c.id === characterId);
			if (!char) return false;
			for (const rel of Object.values(char.relationships)) {
				const axisValue = rel.axes[precondition.key] ?? 0;
				const op = precondition.operator ?? 'gte';
				if (op === 'gte' && axisValue >= (precondition.value as number)) return true;
				if (op === 'lte' && axisValue <= (precondition.value as number)) return true;
				if (op === 'eq' && axisValue === precondition.value) return true;
			}
			return false;
		}

		case 'relationship_tag': {
			// key = tag to check (e.g. 'helped_traveler'), checks if player has this tag on any relationship
			const char = world.characters.find(c => c.id === characterId);
			if (!char) return false;
			for (const rel of Object.values(char.relationships)) {
				if (rel.tags.includes(precondition.key)) return true;
			}
			return false;
		}

		case 'world_fact': {
			const factValue = world.worldFacts?.[precondition.key];
			if (factValue === undefined) return false;
			const op = precondition.operator ?? 'eq';
			if (op === 'eq') return factValue === precondition.value;
			if (typeof factValue === 'number' && typeof precondition.value === 'number') {
				if (op === 'gte') return factValue >= precondition.value;
				if (op === 'lte') return factValue <= precondition.value;
			}
			return factValue === precondition.value;
		}

		case 'location_type':
		case 'tag':
		default:
			return true;
	}
}

export function filterEvents(
	events: EventTemplate[],
	world: WorldState,
	currentSeason: string,
	questlines?: Questline[],
	characterId?: string
): EventTemplate[] {
	return events.filter(event =>
		event.preconditions.every(pre =>
			checkPrecondition(pre, world, currentSeason, questlines ?? [], characterId)
		)
	);
}

export function weightEvents(
	events: EventTemplate[],
	preferences: string[],
	recentEventIds: string[] = []
): Array<{ event: EventTemplate; weight: number }> {
	return events.map(event => {
		let weight = 1;
		for (const tag of event.tags) {
			if (preferences.includes(tag)) {
				weight += 1;
			}
		}
		// Heavily deprioritize recently seen events — nearly zero chance until pool is exhausted
		if (recentEventIds.includes(event.id)) {
			weight *= 0.01;
		}
		return { event, weight };
	});
}

export function selectEvent(
	events: EventTemplate[],
	world: WorldState,
	currentSeason: string,
	preferences: string[],
	questlines?: Questline[],
	characterId?: string
): EventTemplate | null {
	const eligible = filterEvents(events, world, currentSeason, questlines, characterId);
	if (eligible.length === 0) return null;

	const weighted = weightEvents(eligible, preferences, world.recentEventIds ?? []);
	const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

	let roll = Math.random() * totalWeight;
	for (const { event, weight } of weighted) {
		roll -= weight;
		if (roll <= 0) return event;
	}

	return weighted[weighted.length - 1].event;
}
