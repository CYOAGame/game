import type { Questline } from '../../src/lib/types/blocks';
import type { QuestlineProgress } from '../../src/lib/types/state';

export const demonInvasion: Questline = {
	id: 'demon_invasion',
	name: 'The Demon Invasion',
	description: 'A demon lord threatens the realm. Heroes rally, borders fall, and the final siege approaches.',
	stages: [
		{
			id: 'gathering',
			name: 'The Demon Gathers Forces',
			description: 'Rumors of darkness in the borderlands. Life is mostly normal, but tension rises.',
			worldConditions: { dangerLevel: 'low', tradeDisruption: false },
			advancementTriggers: [
				{ type: 'counter', key: 'border_incidents', threshold: 5 }
			],
			regressionTriggers: [],
			flavorShifts: { tavern: 'Travelers speak of strange sightings near the border.' }
		},
		{
			id: 'heroes_rally',
			name: 'Heroes Rally',
			description: 'The threat is undeniable. Warriors and adventurers head to the border.',
			worldConditions: { dangerLevel: 'medium', tradeDisruption: true },
			advancementTriggers: [
				{ type: 'counter', key: 'border_defense', threshold: 10 }
			],
			regressionTriggers: [
				{ type: 'counter', key: 'border_failures', threshold: 5 }
			],
			flavorShifts: { tavern: 'Recruitment posters cover every wall. The mood is grim.' }
		},
		{
			id: 'border_falls',
			name: 'The Border Falls',
			description: 'The border forts have fallen. Refugees stream inland. Danger is everywhere.',
			worldConditions: { dangerLevel: 'high', tradeDisruption: true },
			advancementTriggers: [
				{ type: 'counter', key: 'siege_preparation', threshold: 15 }
			],
			regressionTriggers: [],
			flavorShifts: { tavern: 'Refugees crowd every corner. Food is scarce.' }
		},
		{
			id: 'final_siege',
			name: 'The Final Siege',
			description: 'The demon army is at the gates. Everything comes down to this.',
			worldConditions: { dangerLevel: 'extreme', tradeDisruption: true },
			advancementTriggers: [],
			regressionTriggers: [],
			flavorShifts: { tavern: 'The tavern is silent. Everyone waits.' }
		}
	]
};

export const allQuestlines = [demonInvasion];

export const demonInvasionProgress: QuestlineProgress = {
	questlineId: 'demon_invasion',
	currentStageIndex: 0,
	counters: { border_incidents: 0, border_defense: 0, border_failures: 0, siege_preparation: 0 }
};
