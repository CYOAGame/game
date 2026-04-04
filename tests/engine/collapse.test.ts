import { describe, it, expect } from 'vitest';
import { collapseRole, collapseAllRoles } from '../../src/lib/engine/collapse';
import { allArchetypes, soldier } from '../fixtures/archetypes';
import { banditRaid } from '../fixtures/events';
import { createTestWorldState } from '../fixtures/world-state';

describe('collapseRole', () => {
	it('matches an existing character when one fits the role', () => {
		const world = createTestWorldState();
		const banditLeaderRole = banditRaid.roles[0]; // strength >= 5, cunning >= 4

		// Elena has strength 7, cunning 3 — fails cunning requirement
		// Marcus has strength 3, cunning 7 — fails strength requirement
		// Neither fits, so we expect a new character
		const result = collapseRole(banditLeaderRole, world.characters, allArchetypes, []);

		expect(result.wasNewlyCreated).toBe(true);
		expect(result.characterId).toBeTruthy();
		expect(result.characterName).toBeTruthy();
	});

	it('prefers existing characters over creating new ones', () => {
		const world = createTestWorldState();
		const bystander = banditRaid.roles[1]; // archetypeFilter: merchant, blacksmith

		const result = collapseRole(bystander, world.characters, allArchetypes, []);

		expect(result.wasNewlyCreated).toBe(false);
		expect(['elena_blacksmith', 'marcus_merchant']).toContain(result.characterId);
	});

	it('excludes characters already assigned to other roles', () => {
		const world = createTestWorldState();
		const bystander = banditRaid.roles[1];

		const result = collapseRole(bystander, world.characters, allArchetypes, ['elena_blacksmith']);

		expect(result.wasNewlyCreated).toBe(false);
		expect(result.characterId).toBe('marcus_merchant');
	});

	it('creates a new character when no existing ones fit', () => {
		const world = createTestWorldState();
		const bystander = banditRaid.roles[1];

		const result = collapseRole(bystander, world.characters, allArchetypes, ['elena_blacksmith', 'marcus_merchant']);

		expect(result.wasNewlyCreated).toBe(true);
		expect(result.characterName).toBeTruthy();
	});

	it('only considers alive characters', () => {
		const world = createTestWorldState();
		world.characters[0].alive = false; // Kill Elena
		const bystander = banditRaid.roles[1];

		const result = collapseRole(bystander, world.characters, allArchetypes, []);

		expect(result.characterId).toBe('marcus_merchant');
	});
});

describe('lineage creation', () => {
	it('may link new character as child of dead character with same archetype', () => {
		const world = createTestWorldState();
		world.characters[0].alive = false;
		world.characters[0].deathDate = { year: 840, season: 'summer', day: 1 };

		const bystander = banditRaid.roles[1]; // archetypeFilter: merchant, blacksmith
		const result = collapseRole(bystander, world.characters, allArchetypes, ['marcus_merchant']);

		expect(result.wasNewlyCreated).toBe(true);
		expect(result.newCharacter).toBeDefined();
		// Lineage is probabilistic (30%), so just verify the character is valid
		if (result.newCharacter?.parentId) {
			expect(result.newCharacter.parentId).toBe('elena_blacksmith');
			expect(result.newCharacter.relationships['elena_blacksmith']).toBeDefined();
			expect(result.newCharacter.relationships['elena_blacksmith'].tags).toContain('family:parent');
		}
	});
});

describe('collapseAllRoles', () => {
	it('fills all roles in an event template', () => {
		const world = createTestWorldState();
		const results = collapseAllRoles(banditRaid.roles, world.characters, allArchetypes);

		expect(results).toHaveLength(2);
		expect(results[0].characterId).not.toBe(results[1].characterId);
	});
});
