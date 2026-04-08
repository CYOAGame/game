import type { EventTemplate, Questline } from '../types/blocks';
import type { WorldState } from '../types/state';
import type { StorylineState, Hook } from '../types/storyline';
import { filterEvents } from './event-selector';

export function tensionToUrgency(tension: number): 'calm' | 'stirring' | 'urgent' | 'critical' {
	if (tension <= 25) return 'calm';
	if (tension <= 50) return 'stirring';
	if (tension <= 80) return 'urgent';
	return 'critical';
}

export function updateTension(state: StorylineState, isCurrentlyPlayed: boolean): StorylineState {
	if (isCurrentlyPlayed) {
		return { ...state, tension: 0 };
	}
	const baseDrift = 5 + Math.floor(Math.random() * 11);
	const engagementMultiplier = state.lastPlayerSession ? 1.5 : 0.5;
	const increase = Math.round(baseDrift * engagementMultiplier);
	return { ...state, tension: Math.min(100, state.tension + increase) };
}

export function escalateStorylines(
	storylineStates: Record<string, StorylineState>,
	events: EventTemplate[],
	world: WorldState,
	playedStoryline?: string
): {
	updatedStates: Record<string, StorylineState>;
	newWorldFacts: Record<string, string | number | boolean>;
	escalatedStoryline: string | null;
	npcDriverId: string | null;
} {
	const updatedStates: Record<string, StorylineState> = {};
	const newWorldFacts: Record<string, string | number | boolean> = {};
	let escalatedStoryline: string | null = null;
	let npcDriverId: string | null = null;

	for (const [name, state] of Object.entries(storylineStates)) {
		updatedStates[name] = updateTension(state, name === playedStoryline);
	}

	for (const event of events) {
		if (event.storyline && !updatedStates[event.storyline]) {
			updatedStates[event.storyline] = {
				currentChapter: 1, tension: 0,
				lastPlayerSession: null, lastEscalationDate: null, npcDriverId: null
			};
		}
	}

	let highestTension = 0;
	let highestStoryline: string | null = null;
	for (const [name, state] of Object.entries(updatedStates)) {
		if (name === playedStoryline) continue;
		if (state.tension >= 50 && state.tension > highestTension) {
			highestTension = state.tension;
			highestStoryline = name;
		}
	}

	if (highestStoryline) {
		const state = updatedStates[highestStoryline];
		const currentEvent = events.find(
			e => e.storyline === highestStoryline && e.chapter === state.currentChapter
		);
		if (currentEvent?.escalation) {
			for (const [key, value] of Object.entries(currentEvent.escalation.world_facts_set)) {
				newWorldFacts[key] = value;
			}
			const aliveChars = world.characters.filter(c => c.alive);
			const driver = aliveChars[Math.floor(Math.random() * aliveChars.length)];
			updatedStates[highestStoryline] = {
				...state, currentChapter: state.currentChapter + 1,
				tension: 0, lastEscalationDate: null, npcDriverId: driver?.id ?? null
			};
			escalatedStoryline = highestStoryline;
			npcDriverId = driver?.id ?? null;
		}
	}

	return { updatedStates, newWorldFacts, escalatedStoryline, npcDriverId };
}

export function generateHooks(
	events: EventTemplate[],
	world: WorldState,
	currentSeason: string,
	characterId: string,
	questlines: Questline[]
): Hook[] {
	const eligible = filterEvents(events, world, currentSeason, questlines, characterId);
	const storylineGroups: Record<string, EventTemplate[]> = {};
	const standalones: EventTemplate[] = [];

	for (const event of eligible) {
		if (event.storyline) {
			if (!storylineGroups[event.storyline]) storylineGroups[event.storyline] = [];
			storylineGroups[event.storyline].push(event);
		} else {
			standalones.push(event);
		}
	}

	const hooks: Hook[] = [];

	for (const [storyline, chapters] of Object.entries(storylineGroups)) {
		const slState = world.storylineStates?.[storyline];
		const currentChapter = slState?.currentChapter ?? 1;
		const tension = slState?.tension ?? 0;
		const sorted = chapters
			.filter(e => (e.chapter ?? 1) <= currentChapter)
			.sort((a, b) => (b.chapter ?? 1) - (a.chapter ?? 1));
		const best = sorted[0];
		if (!best) continue;
		const teaserText = best.nodes[best.entryNodeId]?.text?.slice(0, 150) ?? best.name;
		hooks.push({
			eventId: best.id, storyline, chapter: best.chapter ?? null,
			teaserText, tension, urgency: tensionToUrgency(tension),
			isStorylineContinuation: slState?.lastPlayerSession !== null && slState?.lastPlayerSession !== undefined,
			reentryRecap: best.reentry_recap ?? null
		});
	}

	const shuffled = standalones.sort(() => Math.random() - 0.5);
	for (const event of shuffled.slice(0, 3)) {
		const teaserText = event.nodes[event.entryNodeId]?.text?.slice(0, 150) ?? event.name;
		hooks.push({
			eventId: event.id, storyline: null, chapter: null,
			teaserText, tension: 0, urgency: 'calm',
			isStorylineContinuation: false, reentryRecap: null
		});
	}

	hooks.sort((a, b) => b.tension - a.tension);
	return hooks;
}
