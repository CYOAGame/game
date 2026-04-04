import { writable } from 'svelte/store';
import type { GameDate } from '../types/state';

export interface NavigationContext {
	mode: 'new' | 'pre-selected';
	characterId?: string;
	targetDate?: GameDate;
	timeContext: 'past' | 'present' | 'future';
}

export const navigationContext = writable<NavigationContext>({
	mode: 'new',
	timeContext: 'present'
});
