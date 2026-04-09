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

/**
 * Clean teaser text: replace {role.name} placeholders with generic descriptions
 * since roles aren't collapsed yet at hook generation time.
 */
function cleanTeaserText(text: string): string {
	return text
		.replace(/\{(\w+)\.name\}/g, 'someone')
		.replace(/\{(\w+)\.archetype\}/g, 'a local')
		.replace(/\{(\w+)\.\w+\}/g, '')
		.slice(0, 150);
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

	// Build ALL candidate hooks with affinity scores
	const allCandidates: Array<Hook & { affinity: number }> = [];

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
		if (playedEventIds.has(best.id)) continue;

		const affinity = character ? archetypeAffinity(best, character) : 0;
		const teaserText = cleanTeaserText(best.nodes[best.entryNodeId]?.text ?? best.name);
		allCandidates.push({
			eventId: best.id, storyline, chapter: best.chapter ?? null,
			teaserText, tension, urgency: tensionToUrgency(tension),
			isStorylineContinuation: slState?.lastPlayerSession !== null && slState?.lastPlayerSession !== undefined,
			reentryRecap: best.reentry_recap ?? null,
			affinity
		});
	}

	// Standalone hooks
	for (const event of standalones) {
		if (playedEventIds.has(event.id)) continue;
		const affinity = character ? archetypeAffinity(event, character) : 0;
		const teaserText = cleanTeaserText(event.nodes[event.entryNodeId]?.text ?? event.name);
		allCandidates.push({
			eventId: event.id, storyline: null, chapter: null,
			teaserText, tension: 0, urgency: 'calm',
			isStorylineContinuation: false, reentryRecap: null,
			affinity
		});
	}

	// Selection strategy:
	// 1. Always include archetype-specific events (affinity >= 10) - up to 2
	// 2. Include high-tension storylines (tension >= 50) - up to 2
	// 3. Fill remaining slots with best affinity matches - up to total of 5
	// 4. Generic events (affinity 0) only fill if nothing better exists

	type ScoredHook = Hook & { affinity: number };
	const hooks: ScoredHook[] = [];
	const used = new Set<string>();

	// Priority 1: archetype-specific (affinity >= 10)
	const archetypeSpecific = allCandidates
		.filter(h => h.affinity >= 10)
		.sort((a, b) => b.affinity - a.affinity);
	for (const h of archetypeSpecific.slice(0, 2)) {
		hooks.push(h);
		used.add(h.eventId);
	}

	// Priority 2: high-tension storylines
	const urgent = allCandidates
		.filter(h => !used.has(h.eventId) && h.tension >= 50 && h.storyline)
		.sort((a, b) => b.tension - a.tension);
	for (const h of urgent.slice(0, 2)) {
		hooks.push(h);
		used.add(h.eventId);
	}

	// Priority 3: best remaining by combined score (affinity + tension)
	const remaining = allCandidates
		.filter(h => !used.has(h.eventId))
		.sort((a, b) => (b.affinity + b.tension) - (a.affinity + a.tension) || Math.random() - 0.5);
	for (const h of remaining) {
		if (hooks.length >= 4) break;
		// Skip generic (affinity 0) storyline events if we already have archetype matches
		if (h.affinity === 0 && h.storyline && hooks.length >= 2) continue;
		hooks.push(h);
		used.add(h.eventId);
	}

	// Ensure at least 2 hooks
	if (hooks.length < 2) {
		for (const h of allCandidates) {
			if (hooks.length >= 2) break;
			if (!used.has(h.eventId)) {
				hooks.push(h);
				used.add(h.eventId);
			}
		}
	}

	// Sort final list: archetype-specific first, then by tension
	hooks.sort((a, b) => {
		const aSpec = a.affinity >= 10 ? 1 : 0;
		const bSpec = b.affinity >= 10 ? 1 : 0;
		if (aSpec !== bSpec) return bSpec - aSpec;
		return b.tension - a.tension;
	});

	// Strip internal affinity field before returning
	return hooks.map(({ affinity: _, ...hook }) => hook as Hook);
}
