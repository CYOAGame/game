import { describe, it, expect } from 'vitest';
import { dateToDays, daysToDate, compareDates } from '../../src/lib/types/state';
import { createWorldSnapshotAt, generatePastDate, generateFutureDate, suggestCharacters, canGoToPast } from '../../src/lib/engine/timeline';
import { createTestWorldState } from '../fixtures/world-state';
import { allQuestlines } from '../fixtures/questlines';
import type { GameDate } from '../../src/lib/types/state';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const DAYS_PER_SEASON = 30;

describe('dateToDays', () => {
	it('converts a date to linear days', () => {
		const date: GameDate = { year: 845, season: 'spring', day: 1 };
		const days = dateToDays(date, SEASONS, DAYS_PER_SEASON);
		expect(days).toBe(845 * 4 * 30 + 0 * 30 + 1);
	});

	it('accounts for season index', () => {
		const spring = dateToDays({ year: 845, season: 'spring', day: 1 }, SEASONS, DAYS_PER_SEASON);
		const autumn = dateToDays({ year: 845, season: 'autumn', day: 1 }, SEASONS, DAYS_PER_SEASON);
		expect(autumn - spring).toBe(2 * DAYS_PER_SEASON);
	});
});

describe('daysToDate', () => {
	it('roundtrips with dateToDays', () => {
		const original: GameDate = { year: 847, season: 'autumn', day: 14 };
		const days = dateToDays(original, SEASONS, DAYS_PER_SEASON);
		const result = daysToDate(days, SEASONS, DAYS_PER_SEASON);
		expect(result.year).toBe(847);
		expect(result.season).toBe('autumn');
		expect(result.day).toBe(14);
	});
});

describe('compareDates', () => {
	it('compares by year first', () => {
		expect(compareDates({ year: 845, season: 'spring', day: 1 }, { year: 846, season: 'spring', day: 1 }, SEASONS)).toBeLessThan(0);
	});

	it('compares by season with season order', () => {
		expect(compareDates({ year: 845, season: 'spring', day: 1 }, { year: 845, season: 'autumn', day: 1 }, SEASONS)).toBeLessThan(0);
	});

	it('compares by day when year and season match', () => {
		expect(compareDates({ year: 845, season: 'spring', day: 5 }, { year: 845, season: 'spring', day: 10 }, SEASONS)).toBeLessThan(0);
	});
});

describe('createWorldSnapshotAt', () => {
	it('filters characters not yet born', () => {
		const world = createTestWorldState();
		// Elena born year 820, Marcus born year 818
		const snapshot = createWorldSnapshotAt(world, { year: 819, season: 'spring', day: 1 }, allQuestlines);
		const ids = snapshot.characters.map(c => c.id);
		expect(ids).toContain('marcus_merchant');
		expect(ids).not.toContain('elena_blacksmith');
	});

	it('filters dead characters after death date', () => {
		const world = createTestWorldState();
		world.characters[0].alive = false;
		world.characters[0].deathDate = { year: 840, season: 'summer', day: 15 };

		const beforeDeath = createWorldSnapshotAt(world, { year: 839, season: 'spring', day: 1 }, allQuestlines);
		expect(beforeDeath.characters.map(c => c.id)).toContain('elena_blacksmith');

		const afterDeath = createWorldSnapshotAt(world, { year: 841, season: 'spring', day: 1 }, allQuestlines);
		expect(afterDeath.characters.map(c => c.id)).not.toContain('elena_blacksmith');
	});

	it('filters locations not yet built', () => {
		const world = createTestWorldState();
		// market_square built year 800, rusty_flagon built year 830
		const snapshot = createWorldSnapshotAt(world, { year: 825, season: 'spring', day: 1 }, allQuestlines);
		const locationIds = snapshot.locations.map(l => l.id);
		expect(locationIds).toContain('market_square');
		expect(locationIds).not.toContain('rusty_flagon');
	});

	it('filters destroyed locations after destruction date', () => {
		const world = createTestWorldState();
		world.locations[0].destroyedDate = { year: 835, season: 'winter', day: 1 };

		const beforeDestruction = createWorldSnapshotAt(world, { year: 834, season: 'spring', day: 1 }, allQuestlines);
		expect(beforeDestruction.locations.map(l => l.id)).toContain('rusty_flagon');

		const afterDestruction = createWorldSnapshotAt(world, { year: 836, season: 'spring', day: 1 }, allQuestlines);
		expect(afterDestruction.locations.map(l => l.id)).not.toContain('rusty_flagon');
	});

	it('filters timeline entries to before target date', () => {
		const world = createTestWorldState();
		world.timeline = [
			{ id: 'e1', date: { year: 844, season: 'spring', day: 1 }, characterId: 'elena_blacksmith', eventTemplateId: 'market_day', choicesMade: [], consequences: [], summary: 'Early' },
			{ id: 'e2', date: { year: 846, season: 'spring', day: 1 }, characterId: 'elena_blacksmith', eventTemplateId: 'market_day', choicesMade: [], consequences: [], summary: 'Later' }
		];
		const snapshot = createWorldSnapshotAt(world, { year: 845, season: 'spring', day: 1 }, allQuestlines);
		expect(snapshot.timeline).toHaveLength(1);
		expect(snapshot.timeline[0].id).toBe('e1');
	});

	it('defaults questline to stage 0 when no timeline entries exist before date', () => {
		const world = createTestWorldState();
		const snapshot = createWorldSnapshotAt(world, { year: 830, season: 'spring', day: 1 }, allQuestlines);
		expect(snapshot.questlineProgress[0].currentStageIndex).toBe(0);
	});
});

describe('generatePastDate', () => {
	it('returns a date between birth and current date', () => {
		const world = createTestWorldState();
		const elena = world.characters[0];
		const currentDate: GameDate = { year: 845, season: 'spring', day: 1 };
		const pastDate = generatePastDate(elena, currentDate, world.config.dateSystem);
		expect(compareDates(pastDate, elena.birthDate, SEASONS)).toBeGreaterThanOrEqual(0);
		expect(compareDates(pastDate, currentDate, SEASONS)).toBeLessThan(0);
	});

	it('returns different dates on multiple calls', () => {
		const world = createTestWorldState();
		const elena = world.characters[0];
		const currentDate: GameDate = { year: 845, season: 'spring', day: 1 };
		const dates = new Set<number>();
		for (let i = 0; i < 20; i++) {
			const d = generatePastDate(elena, currentDate, world.config.dateSystem);
			dates.add(dateToDays(d, SEASONS, DAYS_PER_SEASON));
		}
		expect(dates.size).toBeGreaterThan(1);
	});
});

describe('generateFutureDate', () => {
	it('returns a date after current date', () => {
		const world = createTestWorldState();
		const elena = world.characters[0];
		const currentDate: GameDate = { year: 845, season: 'spring', day: 1 };
		const futureDate = generateFutureDate(elena, currentDate, world.config.dateSystem);
		expect(futureDate).not.toBeNull();
		expect(compareDates(futureDate!, currentDate, SEASONS)).toBeGreaterThan(0);
	});

	it('returns null for dead characters', () => {
		const world = createTestWorldState();
		const elena = { ...world.characters[0], alive: false, deathDate: { year: 840, season: 'summer' as string, day: 1 } };
		const futureDate = generateFutureDate(elena, { year: 845, season: 'spring', day: 1 }, world.config.dateSystem);
		expect(futureDate).toBeNull();
	});
});

describe('canGoToPast', () => {
	it('returns false when character birth date equals current date', () => {
		const world = createTestWorldState();
		const elena = world.characters[0];
		const result = canGoToPast(elena, elena.birthDate, world.config.dateSystem.seasons, world.timeline);
		expect(result).toBe(false);
	});

	it('returns false when character has no prior timeline entries', () => {
		const world = createTestWorldState();
		const elena = world.characters[0];
		// Elena born year 820, current date year 845 — plenty of range
		// But no timeline entries for elena
		world.timeline = [];
		const currentDate: GameDate = { year: 845, season: 'spring', day: 1 };
		const result = canGoToPast(elena, currentDate, world.config.dateSystem.seasons, world.timeline);
		expect(result).toBe(false);
	});

	it('returns true when character has prior entries and date range exists', () => {
		const world = createTestWorldState();
		const elena = world.characters[0];
		world.timeline = [
			{ id: 'e1', date: { year: 844, season: 'spring', day: 1 }, characterId: 'elena_blacksmith', eventTemplateId: 'market_day', choicesMade: [], consequences: [], summary: 'A day' }
		];
		const currentDate: GameDate = { year: 845, season: 'spring', day: 1 };
		const result = canGoToPast(elena, currentDate, world.config.dateSystem.seasons, world.timeline);
		expect(result).toBe(true);
	});

	it('returns false when other characters have entries but this one does not', () => {
		const world = createTestWorldState();
		const elena = world.characters[0];
		world.timeline = [
			{ id: 'e1', date: { year: 844, season: 'spring', day: 1 }, characterId: 'marcus_merchant', eventTemplateId: 'market_day', choicesMade: [], consequences: [], summary: 'A day' }
		];
		const currentDate: GameDate = { year: 845, season: 'spring', day: 1 };
		const result = canGoToPast(elena, currentDate, world.config.dateSystem.seasons, world.timeline);
		expect(result).toBe(false);
	});
});

describe('suggestCharacters', () => {
	it('returns exactly 3 suggestions', () => {
		const world = createTestWorldState();
		world.playedCharacterIds = ['elena_blacksmith'];
		const suggestions = suggestCharacters('elena_blacksmith', world, ['elena_blacksmith']);
		expect(suggestions).toHaveLength(3);
	});

	it('includes relationship-based suggestion when relationships exist', () => {
		const world = createTestWorldState();
		world.playedCharacterIds = ['elena_blacksmith'];
		const elenaIdx = world.characters.findIndex(c => c.id === 'elena_blacksmith');
		world.characters[elenaIdx].relationships['marcus_merchant'] = { tags: [], axes: { rivalry: 8 } };
		const suggestions = suggestCharacters('elena_blacksmith', world, ['elena_blacksmith']);
		const existingSuggestions = suggestions.filter(s => s.type === 'existing');
		expect(existingSuggestions.map(s => s.characterId)).toContain('marcus_merchant');
	});

	it('always includes someone new as the last suggestion', () => {
		const world = createTestWorldState();
		world.playedCharacterIds = ['elena_blacksmith'];
		const suggestions = suggestCharacters('elena_blacksmith', world, ['elena_blacksmith']);
		expect(suggestions[suggestions.length - 1].type).toBe('new');
	});

	it('suggests descendants when a played character is dead', () => {
		const world = createTestWorldState();
		world.characters[0].alive = false;
		world.characters[0].deathDate = { year: 840, season: 'summer', day: 1 };
		world.characters.push({
			id: 'thora_blacksmith', name: 'Thora', archetypeId: 'blacksmith',
			traits: { strength: 6, cunning: 4, charisma: 5 }, skills: ['forging'],
			locationId: 'market_square', factions: { craftsmen_guild: 5 },
			relationships: { elena_blacksmith: { tags: ['family:parent'], axes: { affection: 7 } } },
			parentId: 'elena_blacksmith',
			birthDate: { year: 838, season: 'spring', day: 1 }, deathDate: null, alive: true
		});
		world.playedCharacterIds = ['elena_blacksmith'];
		const suggestions = suggestCharacters('elena_blacksmith', world, ['elena_blacksmith']);
		const existingSuggestions = suggestions.filter(s => s.type === 'existing');
		expect(existingSuggestions.map(s => s.characterId)).toContain('thora_blacksmith');
	});
});
