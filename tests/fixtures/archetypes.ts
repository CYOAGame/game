import type { Archetype } from '../../src/lib/types/blocks';

export const blacksmith: Archetype = {
	id: 'blacksmith',
	name: 'Blacksmith',
	traits: {
		strength: { min: 5, max: 9 },
		cunning: { min: 2, max: 5 },
		charisma: { min: 3, max: 6 }
	},
	skills: ['forging', 'haggling'],
	namingPatterns: ['Elena', 'Bjorn', 'Thora', 'Garrick'],
	factions: ['craftsmen_guild'],
	locations: ['market_quarter', 'forge_district'],
	activities: ['hammering at the anvil', 'inspecting a blade', 'stoking the forge']
};

export const merchant: Archetype = {
	id: 'merchant',
	name: 'Traveling Merchant',
	traits: {
		strength: { min: 2, max: 5 },
		cunning: { min: 5, max: 9 },
		charisma: { min: 6, max: 9 }
	},
	skills: ['haggling', 'appraisal', 'navigation'],
	namingPatterns: ['Marcus', 'Lydia', 'Fenwick', 'Asha'],
	factions: ['merchant_guild'],
	locations: ['market_quarter', 'docks', 'trade_road'],
	activities: ['counting coins', 'examining wares', 'consulting a ledger']
};

export const soldier: Archetype = {
	id: 'soldier',
	name: 'Soldier',
	traits: {
		strength: { min: 6, max: 9 },
		cunning: { min: 3, max: 6 },
		charisma: { min: 2, max: 5 }
	},
	skills: ['swordsmanship', 'tactics', 'endurance'],
	namingPatterns: ['Aldric', 'Kira', 'Voss', 'Brenna'],
	factions: ['town_guard'],
	locations: ['barracks', 'town_gate', 'watchtower'],
	activities: ['polishing armor', 'drilling formations', 'standing watch']
};

export const allArchetypes = [blacksmith, merchant, soldier];
