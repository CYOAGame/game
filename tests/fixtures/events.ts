import type { EventTemplate } from '../../src/lib/types/blocks';

export const banditRaid: EventTemplate = {
	id: 'bandit_raid',
	name: 'Bandit Raid',
	tags: ['action', 'combat', 'danger'],
	preconditions: [
		{ type: 'questline_stage', key: 'demon_invasion', value: 'border_falls', operator: 'gte' }
	],
	roles: [
		{
			id: 'bandit_leader',
			label: 'The Bandit Leader',
			traitRequirements: { strength: { min: 5 }, cunning: { min: 4 } }
		},
		{
			id: 'bystander',
			label: 'A Frightened Bystander',
			archetypeFilter: ['merchant', 'blacksmith']
		}
	],
	entryNodeId: 'start',
	nodes: {
		start: {
			id: 'start',
			text: 'Shouts erupt from the market square. Three armed figures push through the crowd, blades drawn. {bandit_leader.name} points at the merchant stalls.',
			choices: [
				{
					id: 'fight',
					label: 'Stand your ground and fight',
					preconditions: [{ type: 'trait', key: 'strength', min: 5 }],
					consequences: [
						{ type: 'stat', target: 'strength', value: 1 },
						{ type: 'faction', target: 'town_guard', value: 2 },
						{ type: 'questline', target: 'demon_invasion:border_defense', value: 1 }
					],
					exhaustionCost: 3,
					nextNodeId: 'fight_result'
				},
				{
					id: 'hide',
					label: 'Duck behind the stalls and hide',
					consequences: [
						{ type: 'stat', target: 'cunning', value: 1 }
					],
					exhaustionCost: 1,
					nextNodeId: 'hide_result'
				},
				{
					id: 'help_bystander',
					label: 'Grab {bystander.name} and pull them to safety',
					consequences: [
						{ type: 'relationship', target: '{bystander.id}', value: 3 },
						{ type: 'faction', target: 'town_guard', value: 1 }
					],
					exhaustionCost: 2,
					nextNodeId: 'help_result'
				}
			]
		},
		fight_result: {
			id: 'fight_result',
			text: 'You clash with the nearest bandit. Steel rings against steel. The town guard arrives moments later — your stand bought them time.',
			choices: [
				{
					id: 'pursue',
					label: 'Chase the fleeing bandits',
					preconditions: [{ type: 'skill', key: 'endurance' }],
					consequences: [
						{ type: 'exhaustion', target: 'self', value: 3 },
						{ type: 'questline', target: 'demon_invasion:border_defense', value: 2 }
					],
					exhaustionCost: 4,
					nextNodeId: null
				},
				{
					id: 'stay',
					label: 'Help the wounded in the square',
					consequences: [
						{ type: 'faction', target: 'town_guard', value: 1 },
						{ type: 'world_fact', target: 'market_raid_survivors', value: true }
					],
					exhaustionCost: 2,
					nextNodeId: null
				}
			]
		},
		hide_result: {
			id: 'hide_result',
			text: 'You press yourself against the wooden stall. Through a gap in the planks you see {bandit_leader.name} ransacking the silversmith. The raid is over in minutes.',
			choices: [
				{
					id: 'emerge',
					label: 'Emerge and check on the others',
					consequences: [
						{ type: 'world_fact', target: 'witnessed_raid', value: true }
					],
					exhaustionCost: 1,
					nextNodeId: null
				}
			]
		},
		help_result: {
			id: 'help_result',
			text: '{bystander.name} stumbles as you pull them behind the well. "Thank you," they gasp. "I thought — I thought they were going to—"',
			choices: [
				{
					id: 'comfort',
					label: 'Stay with them until it passes',
					consequences: [
						{ type: 'relationship', target: '{bystander.id}', value: 2 },
						{ type: 'stat', target: 'charisma', value: 1 }
					],
					exhaustionCost: 1,
					nextNodeId: null
				},
				{
					id: 'leave',
					label: 'Make sure they are safe, then head back out',
					consequences: [
						{ type: 'faction', target: 'town_guard', value: 1 }
					],
					exhaustionCost: 2,
					nextNodeId: null
				}
			]
		}
	}
};

export const harvestFestival: EventTemplate = {
	id: 'harvest_festival',
	name: 'Harvest Festival',
	tags: ['social', 'crafting', 'romance'],
	preconditions: [
		{ type: 'season', key: 'season', value: 'autumn' }
	],
	roles: [
		{
			id: 'festival_organizer',
			label: 'The Festival Organizer',
			traitRequirements: { charisma: { min: 5 } }
		}
	],
	entryNodeId: 'start',
	nodes: {
		start: {
			id: 'start',
			text: 'The village square is strung with lanterns. The smell of roasted apples and spiced cider fills the air. {festival_organizer.name} waves you over.',
			choices: [
				{
					id: 'join_feast',
					label: 'Join the communal feast',
					consequences: [
						{ type: 'stat', target: 'charisma', value: 1 },
						{ type: 'faction', target: 'village_folk', value: 1 }
					],
					exhaustionCost: 1,
					nextNodeId: null
				},
				{
					id: 'enter_contest',
					label: 'Enter the crafting contest',
					preconditions: [{ type: 'skill', key: 'forging' }],
					consequences: [
						{ type: 'stat', target: 'cunning', value: 1 },
						{ type: 'faction', target: 'craftsmen_guild', value: 2 }
					],
					exhaustionCost: 2,
					nextNodeId: null
				}
			]
		}
	}
};

export const allEvents = [banditRaid, harvestFestival];
