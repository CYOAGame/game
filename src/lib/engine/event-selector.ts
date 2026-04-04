import type { EventTemplate, EventPrecondition, Questline } from '../types/blocks';
import type { WorldState } from '../types/state';

function checkPrecondition(
	precondition: EventPrecondition,
	world: WorldState,
	currentSeason: string,
	questlines: Questline[]
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
	questlines?: Questline[]
): EventTemplate[] {
	return events.filter(event =>
		event.preconditions.every(pre =>
			checkPrecondition(pre, world, currentSeason, questlines ?? [])
		)
	);
}

export function weightEvents(
	events: EventTemplate[],
	preferences: string[]
): Array<{ event: EventTemplate; weight: number }> {
	return events.map(event => {
		let weight = 1;
		for (const tag of event.tags) {
			if (preferences.includes(tag)) {
				weight += 1;
			}
		}
		return { event, weight };
	});
}

export function selectEvent(
	events: EventTemplate[],
	world: WorldState,
	currentSeason: string,
	preferences: string[],
	questlines?: Questline[]
): EventTemplate | null {
	const eligible = filterEvents(events, world, currentSeason, questlines);
	if (eligible.length === 0) return null;

	const weighted = weightEvents(eligible, preferences);
	const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

	let roll = Math.random() * totalWeight;
	for (const { event, weight } of weighted) {
		roll -= weight;
		if (roll <= 0) return event;
	}

	return weighted[weighted.length - 1].event;
}
