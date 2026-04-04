import type { Role } from '../types/blocks';
import type { Archetype } from '../types/blocks';
import type { Character } from '../types/state';
import type { CollapsedRole } from '../types/session';

function characterMatchesRole(character: Character, role: Role): boolean {
	if (!character.alive) return false;

	if (role.archetypeFilter && !role.archetypeFilter.includes(character.archetypeId)) {
		return false;
	}

	if (role.traitRequirements) {
		for (const [trait, req] of Object.entries(role.traitRequirements)) {
			const value = character.traits[trait] ?? 0;
			if (req.min !== undefined && value < req.min) return false;
			if (req.max !== undefined && value > req.max) return false;
		}
	}

	if (role.factionRequirements) {
		for (const factionId of role.factionRequirements) {
			if (!(factionId in character.factions)) return false;
		}
	}

	return true;
}

function randomInRange(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function instantiateFromArchetype(archetypes: Archetype[], role: Role): { character: Character; name: string } {
	let candidates = archetypes;
	if (role.archetypeFilter) {
		candidates = archetypes.filter(a => role.archetypeFilter!.includes(a.id));
	}
	if (candidates.length === 0) {
		candidates = archetypes;
	}

	const archetype = candidates[Math.floor(Math.random() * candidates.length)];
	const name = archetype.namingPatterns[Math.floor(Math.random() * archetype.namingPatterns.length)];
	const id = `${name.toLowerCase()}_${archetype.id}_${Date.now()}`;

	const traits: Record<string, number> = {};
	for (const [trait, range] of Object.entries(archetype.traits)) {
		let value = randomInRange(range.min, range.max);
		if (role.traitRequirements?.[trait]?.min !== undefined) {
			value = Math.max(value, role.traitRequirements[trait].min!);
		}
		if (role.traitRequirements?.[trait]?.max !== undefined) {
			value = Math.min(value, role.traitRequirements[trait].max!);
		}
		traits[trait] = value;
	}

	const character: Character = {
		id,
		name,
		archetypeId: archetype.id,
		traits,
		skills: [...archetype.skills],
		locationId: '',
		factions: {},
		relationships: {},
		birthDate: { year: 800, season: 'spring', day: 1 },
		deathDate: null,
		alive: true
	};

	return { character, name };
}

export function collapseRole(
	role: Role,
	characters: Character[],
	archetypes: Archetype[],
	excludeIds: string[]
): CollapsedRole & { newCharacter?: Character } {
	const candidates = characters.filter(
		c => !excludeIds.includes(c.id) && characterMatchesRole(c, role)
	);

	if (candidates.length > 0) {
		const chosen = candidates[Math.floor(Math.random() * candidates.length)];
		return {
			roleId: role.id,
			characterId: chosen.id,
			characterName: chosen.name,
			wasNewlyCreated: false
		};
	}

	const { character, name } = instantiateFromArchetype(archetypes, role);
	return {
		roleId: role.id,
		characterId: character.id,
		characterName: name,
		wasNewlyCreated: true,
		newCharacter: character
	};
}

export function collapseAllRoles(
	roles: Role[],
	characters: Character[],
	archetypes: Archetype[]
): Array<CollapsedRole & { newCharacter?: Character }> {
	const results: Array<CollapsedRole & { newCharacter?: Character }> = [];
	const assignedIds: string[] = [];

	for (const role of roles) {
		const result = collapseRole(role, characters, archetypes, assignedIds);
		assignedIds.push(result.characterId);
		results.push(result);
	}

	return results;
}
