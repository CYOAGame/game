import type { GameDate } from './state';

export interface StorylineState {
	currentChapter: number;
	tension: number;
	lastPlayerSession: string | null;
	lastEscalationDate: GameDate | null;
	npcDriverId: string | null;
}

export interface EscalationConfig {
	chance_base: number;
	advances_to: string;
	world_facts_set: Record<string, string | number | boolean>;
}

export interface Hook {
	eventId: string;
	storyline: string | null;
	chapter: number | null;
	teaserText: string;
	tension: number;
	urgency: 'calm' | 'stirring' | 'urgent' | 'critical';
	isStorylineContinuation: boolean;
	reentryRecap: string | null;
}
