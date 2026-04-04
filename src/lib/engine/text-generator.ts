import type { CollapsedRole } from '../types/session';
import type { Character } from '../types/state';

export function interpolateText(
	text: string,
	roles: CollapsedRole[],
	characters: Character[]
): string {
	return text.replace(/\{(\w+)\.(\w+)\}/g, (match, roleId, property) => {
		const role = roles.find(r => r.roleId === roleId);
		if (!role) return match;

		const character = characters.find(c => c.id === role.characterId);

		switch (property) {
			case 'name':
				return role.characterName;
			case 'id':
				return role.characterId;
			case 'archetype':
				return character?.archetypeId ?? match;
			case 'activity':
				return character?.archetypeId ?? match;
			default:
				if (character && property in character.traits) {
					return String(character.traits[property]);
				}
				return match;
		}
	});
}
