import { describe, it, expect } from 'vitest';
import { resolveChoice, checkPreconditions, getAvailableChoices } from '../../src/lib/engine/choice-resolver';
import { banditRaid } from '../fixtures/events';
import { createTestWorldState } from '../fixtures/world-state';
import type { PlaySession } from '../../src/lib/types/session';

function createTestSession(): PlaySession {
	return {
		characterId: 'elena_blacksmith',
		date: { year: 847, season: 'spring', day: 14 },
		eventTemplateId: 'bandit_raid',
		collapsedRoles: [
			{ roleId: 'bandit_leader', characterId: 'new_bandit_1', characterName: 'Krag', wasNewlyCreated: true },
			{ roleId: 'bystander', characterId: 'marcus_merchant', characterName: 'Marcus', wasNewlyCreated: false }
		],
		currentNodeId: 'start',
		choiceLog: [],
		exhaustion: 0,
		maxExhaustion: 10,
		isDead: false,
		isComplete: false,
		dayTypePreferences: ['action'],
		timeContext: 'present'
	};
}

describe('checkPreconditions', () => {
	it('passes when character meets trait requirements', () => {
		const world = createTestWorldState();
		const elena = world.characters[0]; // strength: 7
		const fightChoice = banditRaid.nodes.start.choices[0]; // strength >= 5
		expect(checkPreconditions(fightChoice, elena)).toBe(true);
	});

	it('fails when character does not meet trait requirements', () => {
		const world = createTestWorldState();
		const marcus = world.characters[1]; // strength: 3
		const fightChoice = banditRaid.nodes.start.choices[0]; // strength >= 5
		expect(checkPreconditions(fightChoice, marcus)).toBe(false);
	});

	it('passes skill checks when character has the skill', () => {
		const world = createTestWorldState();
		const elena = world.characters[0]; // skills: forging, haggling
		const contestChoice = {
			id: 'test', label: 'test',
			preconditions: [{ type: 'skill' as const, key: 'forging' }],
			consequences: [], exhaustionCost: 0, nextNodeId: null
		};
		expect(checkPreconditions(contestChoice, elena)).toBe(true);
	});
});

describe('getAvailableChoices', () => {
	it('filters choices by preconditions and exhaustion', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const elena = world.characters[0];
		const node = banditRaid.nodes.start;
		const available = getAvailableChoices(node, elena, session.exhaustion, session.maxExhaustion);
		// Elena has strength 7 — can fight. All others have no trait reqs.
		expect(available.length).toBe(3);
	});

	it('excludes choices when exhaustion would exceed max', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		session.exhaustion = 9; // Only 1 left before max of 10
		const elena = world.characters[0];
		const node = banditRaid.nodes.start;
		const available = getAvailableChoices(node, elena, session.exhaustion, session.maxExhaustion);
		// fight costs 3 (too much), hide costs 1 (ok), help costs 2 (too much)
		expect(available.map(c => c.id)).toEqual(['hide']);
	});
});

describe('resolveChoice', () => {
	it('applies stat consequences to the character', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const fightChoice = banditRaid.nodes.start.choices[0];
		const result = resolveChoice(fightChoice, session, world);
		const elena = result.world.characters.find(c => c.id === 'elena_blacksmith')!;
		expect(elena.traits.strength).toBe(8); // was 7, +1
	});

	it('applies faction consequences', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const fightChoice = banditRaid.nodes.start.choices[0];
		const result = resolveChoice(fightChoice, session, world);
		const guard = result.world.factions.find(f => f.id === 'town_guard')!;
		expect(guard.mood).toBe(7); // was 5, +2
	});

	it('increases exhaustion', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const fightChoice = banditRaid.nodes.start.choices[0]; // cost 3
		const result = resolveChoice(fightChoice, session, world);
		expect(result.session.exhaustion).toBe(3);
	});

	it('advances to the next node', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const fightChoice = banditRaid.nodes.start.choices[0]; // nextNodeId: fight_result
		const result = resolveChoice(fightChoice, session, world);
		expect(result.session.currentNodeId).toBe('fight_result');
	});

	it('does not mark session complete when nextNodeId is null (event chaining handles this)', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		session.currentNodeId = 'hide_result';
		const emergeChoice = banditRaid.nodes.hide_result.choices[0]; // nextNodeId: null
		const result = resolveChoice(emergeChoice, session, world);
		// Session completion is now handled by the UI layer for event chaining
		expect(result.session.isComplete).toBe(false);
	});

	it('handles death consequence', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const deathChoice = {
			id: 'die', label: 'die',
			consequences: [{ type: 'death' as const, target: 'self', value: true }],
			exhaustionCost: 0, nextNodeId: null
		};
		const result = resolveChoice(deathChoice, session, world);
		expect(result.session.isDead).toBe(true);
		expect(result.session.isComplete).toBe(true);
		const elena = result.world.characters.find(c => c.id === 'elena_blacksmith')!;
		expect(elena.alive).toBe(false);
	});
});
