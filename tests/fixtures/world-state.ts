import type { WorldState } from '../../src/lib/types/state';
import type { WorldConfig } from '../../src/lib/types/blocks';
import { allLocationInstances } from './locations';
import { demonInvasionProgress } from './questlines';

export const testConfig: WorldConfig = {
	name: 'Ironhaven',
	description: 'A medieval kingdom under the shadow of a rising demon lord.',
	setting: 'medieval',
	dateSystem: {
		seasons: ['spring', 'summer', 'autumn', 'winter'],
		daysPerSeason: 30,
		startYear: 845
	},
	startingFactions: [
		{ id: 'town_guard', name: 'Town Guard', description: 'The local militia', initialMood: 5 },
		{ id: 'craftsmen_guild', name: "Craftsmen's Guild", description: 'Artisans and makers', initialMood: 6 },
		{ id: 'merchant_guild', name: 'Merchant Guild', description: 'Traders and shopkeepers', initialMood: 7 }
	],
	activeQuestlines: ['demon_invasion'],
	theme: {
		backgroundImage: 'themes/default/background.jpg',
		fontFamily: 'Georgia, serif'
	}
};

export const elenaCharacter = {
	id: 'elena_blacksmith',
	name: 'Elena',
	archetypeId: 'blacksmith',
	traits: { strength: 7, cunning: 3, charisma: 5 },
	skills: ['forging', 'haggling'],
	locationId: 'market_square',
	factions: { town_guard: 5, craftsmen_guild: 7 },
	relationships: {},
	birthDate: { year: 820, season: 'spring', day: 12 },
	deathDate: null,
	alive: true
};

export const marcusCharacter = {
	id: 'marcus_merchant',
	name: 'Marcus',
	archetypeId: 'merchant',
	traits: { strength: 3, cunning: 7, charisma: 8 },
	skills: ['haggling', 'appraisal', 'navigation'],
	locationId: 'market_square',
	factions: { merchant_guild: 8 },
	relationships: {
		elena_blacksmith: { tags: ['trade_partner'], axes: { affection: 2, trust: 3 } }
	},
	birthDate: { year: 818, season: 'autumn', day: 5 },
	deathDate: null,
	alive: true
};

export function createTestWorldState(): WorldState {
	return {
		config: testConfig,
		characters: [
			{ ...elenaCharacter, relationships: { ...elenaCharacter.relationships } },
			{ ...marcusCharacter, relationships: { ...marcusCharacter.relationships } }
		],
		timeline: [],
		factions: [
			{ id: 'town_guard', mood: 5 },
			{ id: 'craftsmen_guild', mood: 6 },
			{ id: 'merchant_guild', mood: 7 }
		],
		questlineProgress: [{ ...demonInvasionProgress }],
		locations: allLocationInstances.map(l => ({ ...l })),
		playedCharacterIds: [],
		recentEventIds: [],
		worldFacts: {}
	};
}
