import { writable, derived } from 'svelte/store';
import type { PlaySession } from '../types/session';

export const playSession = writable<PlaySession | null>(null);

export const narrativeLog = writable<Array<{ text: string; choiceLabel?: string }>>([]);

export const isPlaying = derived(playSession, ($session) =>
	$session !== null && !$session.isComplete
);

export const exhaustionPercent = derived(playSession, ($session) => {
	if (!$session) return 0;
	return Math.round(($session.exhaustion / $session.maxExhaustion) * 100);
});
