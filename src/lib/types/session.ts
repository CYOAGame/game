import type { GameDate, Character } from './state';
import type { ChoiceNode, Consequence, Role } from './blocks';

export interface ChoiceRecord {
	nodeId: string;
	choiceId: string;
	text: string;
	narrativeText: string;
	consequences: Consequence[];
	timestamp: number;
}

export interface CollapsedRole {
	roleId: string;
	characterId: string;
	characterName: string;
	wasNewlyCreated: boolean;
}

export interface PlaySession {
	characterId: string;
	date: GameDate;
	eventTemplateId: string;
	collapsedRoles: CollapsedRole[];
	currentNodeId: string;
	choiceLog: ChoiceRecord[];
	exhaustion: number;
	maxExhaustion: number;
	isDead: boolean;
	isComplete: boolean;
	dayTypePreferences: string[];
	timeContext: 'past' | 'present' | 'future';
}

export type SessionOutcome = 'save' | 'discard' | 'replay';

export type NextEntryChoice =
	| { type: 'past'; characterId: string }
	| { type: 'future'; characterId: string }
	| { type: 'someone_else'; characterId: string };
