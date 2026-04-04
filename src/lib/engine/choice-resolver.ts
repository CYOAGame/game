import type { Choice, ChoiceNode, Consequence } from '../types/blocks';
import type { Character, WorldState } from '../types/state';
import type { PlaySession, ChoiceRecord } from '../types/session';

export function checkPreconditions(choice: Choice, character: Character): boolean {
	if (!choice.preconditions) return true;
	for (const pre of choice.preconditions) {
		switch (pre.type) {
			case 'trait': {
				const value = character.traits[pre.key] ?? 0;
				if (pre.min !== undefined && value < pre.min) return false;
				break;
			}
			case 'skill': {
				if (!character.skills.includes(pre.key)) return false;
				break;
			}
			case 'faction': {
				if (!(pre.key in character.factions)) return false;
				if (pre.min !== undefined && character.factions[pre.key] < pre.min) return false;
				break;
			}
			case 'item': break; // Not implemented in Phase 1
		}
	}
	return true;
}

export function getAvailableChoices(
	node: ChoiceNode, character: Character,
	currentExhaustion: number, maxExhaustion: number
): Choice[] {
	return node.choices.filter(choice => {
		if (currentExhaustion + choice.exhaustionCost > maxExhaustion) return false;
		return checkPreconditions(choice, character);
	});
}

function clone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

function applyConsequence(
	consequence: Consequence, characterId: string,
	world: WorldState, session: PlaySession
): void {
	switch (consequence.type) {
		case 'stat': {
			const char = world.characters.find(c => c.id === characterId);
			if (char && typeof consequence.value === 'number') {
				char.traits[consequence.target] = (char.traits[consequence.target] ?? 0) + consequence.value;
			}
			break;
		}
		case 'faction': {
			const faction = world.factions.find(f => f.id === consequence.target);
			if (faction && typeof consequence.value === 'number') {
				faction.mood += consequence.value;
			}
			const char = world.characters.find(c => c.id === characterId);
			if (char && typeof consequence.value === 'number') {
				char.factions[consequence.target] = (char.factions[consequence.target] ?? 0) + consequence.value;
			}
			break;
		}
		case 'questline': {
			const [questlineId, counterKey] = consequence.target.split(':');
			const progress = world.questlineProgress.find(q => q.questlineId === questlineId);
			if (progress && typeof consequence.value === 'number') {
				progress.counters[counterKey] = (progress.counters[counterKey] ?? 0) + consequence.value;
			}
			break;
		}
		case 'relationship': {
			const char = world.characters.find(c => c.id === characterId);
			if (char && typeof consequence.value === 'number') {
				let targetId = consequence.target;
				const roleMatch = targetId.match(/^\{(\w+)\.id\}$/);
				if (roleMatch) {
					const role = session.collapsedRoles.find(r => r.roleId === roleMatch[1]);
					if (role) targetId = role.characterId;
				}
				if (!char.relationships[targetId]) {
					char.relationships[targetId] = { tags: [], axes: {} };
				}
				const axis = consequence.axis ?? 'affection';
				char.relationships[targetId].axes[axis] = (char.relationships[targetId].axes[axis] ?? 0) + consequence.value;
			}
			break;
		}
		case 'relationship_tag': {
			const char = world.characters.find(c => c.id === characterId);
			if (char && typeof consequence.value === 'string') {
				let targetId = consequence.target;
				const roleMatch = targetId.match(/^\{(\w+)\.id\}$/);
				if (roleMatch) {
					const role = session.collapsedRoles.find(r => r.roleId === roleMatch[1]);
					if (role) targetId = role.characterId;
				}
				if (!char.relationships[targetId]) {
					char.relationships[targetId] = { tags: [], axes: {} };
				}
				if (!char.relationships[targetId].tags.includes(consequence.value)) {
					char.relationships[targetId].tags.push(consequence.value);
				}
			}
			break;
		}
		case 'world_fact': break; // Stored as timeline note
		case 'death': {
			const char = world.characters.find(c => c.id === characterId);
			if (char) {
				char.alive = false;
				char.deathDate = session.date;
			}
			session.isDead = true;
			session.isComplete = true;
			break;
		}
		case 'exhaustion': {
			if (typeof consequence.value === 'number') {
				session.exhaustion += consequence.value;
			}
			break;
		}
	}
}

export function resolveChoice(
	choice: Choice, session: PlaySession, world: WorldState
): { session: PlaySession; world: WorldState } {
	const newWorld = clone(world);
	const newSession = clone(session);

	newSession.exhaustion += choice.exhaustionCost;
	if (newSession.exhaustion >= newSession.maxExhaustion) {
		newSession.isComplete = true;
	}

	for (const consequence of choice.consequences) {
		applyConsequence(consequence, newSession.characterId, newWorld, newSession);
	}

	const record: ChoiceRecord = {
		nodeId: newSession.currentNodeId,
		choiceId: choice.id,
		text: choice.label,
		narrativeText: '',
		consequences: choice.consequences,
		timestamp: Date.now()
	};
	newSession.choiceLog.push(record);

	if (choice.nextNodeId !== null) {
		newSession.currentNodeId = choice.nextNodeId;
	}
	// Note: when nextNodeId is null the event is finished, but the session
	// is NOT automatically marked complete — the journal page decides
	// whether to chain another event or end the day.

	return { session: newSession, world: newWorld };
}
