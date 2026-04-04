import { describe, it, expect } from 'vitest';
import { interpolateText } from '../../src/lib/engine/text-generator';
import type { CollapsedRole } from '../../src/lib/types/session';
import type { Character } from '../../src/lib/types/state';

describe('interpolateText', () => {
	const roles: CollapsedRole[] = [
		{ roleId: 'bandit_leader', characterId: 'krag_1', characterName: 'Krag', wasNewlyCreated: true },
		{ roleId: 'bystander', characterId: 'marcus_merchant', characterName: 'Marcus', wasNewlyCreated: false }
	];

	const characters: Character[] = [
		{
			id: 'krag_1', name: 'Krag', archetypeId: 'soldier',
			traits: { strength: 8 }, skills: ['swordsmanship'],
			locationId: '', factions: {}, relationships: {},
			birthDate: { year: 810, season: 'winter', day: 3 },
			deathDate: null, alive: true
		},
		{
			id: 'marcus_merchant', name: 'Marcus', archetypeId: 'merchant',
			traits: { cunning: 7 }, skills: ['haggling'],
			locationId: '', factions: {}, relationships: {},
			birthDate: { year: 818, season: 'autumn', day: 5 },
			deathDate: null, alive: true
		}
	];

	it('replaces role name references', () => {
		const text = '{bandit_leader.name} points at the stalls.';
		expect(interpolateText(text, roles, characters)).toBe('Krag points at the stalls.');
	});

	it('replaces role id references', () => {
		const text = 'Helped {bystander.id} escape.';
		expect(interpolateText(text, roles, characters)).toBe('Helped marcus_merchant escape.');
	});

	it('replaces role archetype references', () => {
		const text = '{bystander.name} the {bystander.archetype} nods.';
		expect(interpolateText(text, roles, characters)).toBe('Marcus the merchant nods.');
	});

	it('handles multiple replacements in one string', () => {
		const text = '{bandit_leader.name} threatens {bystander.name}.';
		expect(interpolateText(text, roles, characters)).toBe('Krag threatens Marcus.');
	});

	it('leaves unknown references unchanged', () => {
		const text = '{unknown_role.name} does something.';
		expect(interpolateText(text, roles, characters)).toBe('{unknown_role.name} does something.');
	});
});
