import { writable } from 'svelte/store';
import type { GameDate } from '../types/state';
import type { Hook } from '../types/storyline';

export interface NavigationContext {
	mode: 'new' | 'pre-selected';
	characterId?: string;
	targetDate?: GameDate;
	timeContext: 'past' | 'present' | 'future';
	selectedHook?: Hook;
}

export const navigationContext = writable<NavigationContext>({
	mode: 'new',
	timeContext: 'present'
});
