import { describe, it, expect } from 'vitest';
import { formatJournalEntry, journalFilePath } from '../../src/lib/git/journal-formatter';
import type { ChoiceRecord } from '../../src/lib/types/session';
import type { Character } from '../../src/lib/types/state';

describe('formatJournalEntry', () => {
	it('formats a session into markdown', () => {
		const character: Character = {
			id: 'elena', name: 'Elena', archetypeId: 'blacksmith',
			traits: {}, skills: [], locationId: '', factions: {}, relationships: {},
			birthDate: { year: 820, season: 'spring', day: 1 }, deathDate: null, alive: true
		};
		const choiceLog: ChoiceRecord[] = [{
			nodeId: 'start', choiceId: 'browse', text: 'Browse the wares',
			narrativeText: 'The market was busy today.',
			consequences: [{ type: 'stat', target: 'cunning', value: 1 }], timestamp: 1000
		}];
		const result = formatJournalEntry(character, { year: 847, season: 'spring', day: 14 }, choiceLog);
		expect(result).toContain('# Elena the Blacksmith');
		expect(result).toContain('Spring, Day 14, Year 847');
		expect(result).toContain('> Browse the wares');
	});
	it('includes death notice', () => {
		const character: Character = {
			id: 'elena', name: 'Elena', archetypeId: 'blacksmith',
			traits: {}, skills: [], locationId: '', factions: {}, relationships: {},
			birthDate: { year: 820, season: 'spring', day: 1 },
			deathDate: { year: 847, season: 'spring', day: 14 }, alive: false
		};
		const result = formatJournalEntry(character, { year: 847, season: 'spring', day: 14 }, [], true);
		expect(result).toContain('did not survive');
	});
});

describe('journalFilePath', () => {
	it('generates correct path', () => {
		const character = { id: 'elena-blacksmith' } as any;
		const date = { year: 847, season: 'spring', day: 14 };
		expect(journalFilePath(character, date)).toBe('journals/elena-blacksmith/0847-spring-14.md');
	});
});
