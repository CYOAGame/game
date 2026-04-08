import type { EventTemplate, Questline } from '../types/blocks';
import type { WorldState, Character } from '../types/state';
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

/**
 * Score how well an event matches a character's archetype and skills.
 * Higher = better match. 0 = generic event with no special affinity.
 */
function archetypeAffinity(event: EventTemplate, character: Character): number {
	let score = 0;

	// Check if event has archetype precondition matching this character
	for (const pre of event.preconditions) {
		if (pre.type === 'archetype') {
			score += 10; // This event was MADE for this archetype
		}
		if (pre.type === 'skill') {
			if (character.skills.includes(pre.key)) score += 5;
		}
	}

	// Check tag overlap with archetype's typical activities
	const archetypeTagMap: Record<string, string[]> = {
		blacksmith: ['crafting', 'commerce'],
		merchant: ['commerce', 'social', 'intrigue'],
		soldier: ['action', 'combat'],
		farmer: ['rural', 'social'],
		scholar: ['intrigue', 'exploration'],
		healer: ['social'],
		innkeeper: ['social', 'intrigue'],
		thief: ['intrigue', 'action'],
		noble: ['intrigue', 'social'],
		priest: ['social'],
		hunter: ['action', 'exploration'],
		baker: ['crafting', 'commerce', 'social'],
		brewer: ['crafting', 'commerce', 'social'],
		guard: ['action', 'combat'],
		archer: ['action', 'combat', 'exploration'],
		knight: ['action', 'combat'],
		scout: ['exploration', 'action'],
		bard: ['social', 'romance'],
		courier: ['action', 'exploration'],
		gravedigger: ['intrigue', 'exploration'],
		smuggler: ['intrigue', 'action'],
		fisherman: ['exploration'],
		miner: ['exploration', 'crafting'],
	};
	const affinityTags = archetypeTagMap[character.archetypeId] ?? [];
	for (const tag of event.tags) {
		if (affinityTags.includes(tag)) score += 2;
	}

	return score;
}

export function generateHooks(
	events: EventTemplate[],
	world: WorldState,
	currentSeason: string,
	characterId: string,
	questlines: Questline[]
): Hook[] {
	const eligible = filterEvents(events, world, currentSeason, questlines, characterId);
	const character = world.characters.find(c => c.id === characterId);

	// Track which events this character has already played (from timeline)
	const playedEventIds = new Set(
		world.timeline
			.filter(e => e.characterId === characterId)
			.map(e => e.eventTemplateId)
	);

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

	// Storyline hooks
	for (const [storyline, chapters] of Object.entries(storylineGroups)) {
		const slState = world.storylineStates?.[storyline];
		const currentChapter = slState?.currentChapter ?? 1;
		const tension = slState?.tension ?? 0;
		const sorted = chapters
			.filter(e => (e.chapter ?? 1) <= currentChapter)
			.sort((a, b) => (b.chapter ?? 1) - (a.chapter ?? 1));
		const best = sorted[0];
		if (!best) continue;

		// Skip if this character already played this exact event
		if (playedEventIds.has(best.id)) continue;

		const affinity = character ? archetypeAffinity(best, character) : 0;
		const teaserText = best.nodes[best.entryNodeId]?.text?.slice(0, 150) ?? best.name;
		hooks.push({
			eventId: best.id, storyline, chapter: best.chapter ?? null,
			teaserText, tension: tension + affinity, // affinity boosts effective tension for sorting
			urgency: tensionToUrgency(tension),
			isStorylineContinuation: slState?.lastPlayerSession !== null && slState?.lastPlayerSession !== undefined,
			reentryRecap: best.reentry_recap ?? null
		});
	}

	// Standalone hooks - prioritize archetype-matched events
	const scored = standalones
		.filter(e => !playedEventIds.has(e.id))
		.map(event => ({
			event,
			affinity: character ? archetypeAffinity(event, character) : 0
		}))
		.sort((a, b) => b.affinity - a.affinity || Math.random() - 0.5);

	// Take top archetype-matched standalones (up to 2) plus 1 random
	const archetypeMatched = scored.filter(s => s.affinity > 0).slice(0, 2);
	const generic = scored.filter(s => s.affinity === 0).slice(0, 1);
	const standaloneHooks = [...archetypeMatched, ...generic];

	for (const { event, affinity } of standaloneHooks) {
		const teaserText = event.nodes[event.entryNodeId]?.text?.slice(0, 150) ?? event.name;
		hooks.push({
			eventId: event.id, storyline: null, chapter: null,
			teaserText, tension: affinity, urgency: 'calm',
			isStorylineContinuation: false, reentryRecap: null
		});
	}

	// Sort: highest tension/affinity first
	hooks.sort((a, b) => b.tension - a.tension);
	return hooks;
}
