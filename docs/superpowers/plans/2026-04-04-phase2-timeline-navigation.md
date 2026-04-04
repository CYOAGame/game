# Phase 2: Timeline Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable players to navigate through time (past/future) and across characters (someone else) after completing a journal entry, with vector-based relationships and location lifespans.

**Architecture:** New `timeline.ts` engine module handles world snapshots, date generation, and character suggestions. Type updates propagate through existing engine modules (choice-resolver, collapse, world-loader). Session-end and setup pages gain new navigation flows.

**Tech Stack:** SvelteKit, TypeScript, Vitest (existing stack — no new dependencies)

---

## File Structure

```
Modified:
  src/lib/types/state.ts            — Relationship type, Character.relationships, LocationInstance.builtDate/destroyedDate, WorldState.playedCharacterIds
  src/lib/types/blocks.ts           — Consequence.axis, relationship_tag type, LocationType.natural
  src/lib/types/session.ts          — PlaySession.timeContext, playedCharacterIds
  src/lib/engine/choice-resolver.ts — axis-based relationship consequences, relationship_tag handling
  src/lib/engine/collapse.ts        — lineage creation for dead ancestors
  src/lib/engine/world-loader.ts    — migration for old relationship format
  src/routes/session-end/+page.svelte — functional Past/Future/Someone Else buttons
  src/routes/journal/setup/+page.svelte — pre-selected character mode
  src/routes/+page.svelte           — demo world events with axis-based consequences
  tests/fixtures/world-state.ts     — updated relationship format
  tests/fixtures/locations.ts       — updated with builtDate
  tests/engine/choice-resolver.test.ts — updated for new relationship format

Created:
  src/lib/engine/timeline.ts        — createWorldSnapshotAt, generatePastDate, generateFutureDate, suggestCharacters, date utils
  tests/engine/timeline.test.ts     — TDD tests for timeline engine
  src/lib/stores/navigation.ts      — store for passing navigation context between pages
```

---

### Task 1: Type Updates

**Files:**
- Modify: `src/lib/types/state.ts`
- Modify: `src/lib/types/blocks.ts`
- Modify: `src/lib/types/session.ts`

- [ ] **Step 1: Update state.ts with Relationship type and Character changes**

Replace the contents of `src/lib/types/state.ts`:

```ts
/** Vector-based relationship between two characters */
export interface Relationship {
	tags: string[];
	axes: Record<string, number>;
}

/** A collapsed (real) character living in the world */
export interface Character {
	id: string;
	name: string;
	archetypeId: string;
	traits: Record<string, number>;
	skills: string[];
	locationId: string;
	factions: Record<string, number>;
	relationships: Record<string, Relationship>;
	parentId?: string;
	birthDate: GameDate;
	deathDate: GameDate | null;
	alive: boolean;
}

export interface GameDate {
	year: number;
	season: string;
	day: number;
}

/**
 * Compare two GameDates using a season ordering array.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareDates(a: GameDate, b: GameDate, seasonOrder?: string[]): number {
	if (a.year !== b.year) return a.year - b.year;
	if (a.season !== b.season) {
		if (!seasonOrder) return 0;
		return seasonOrder.indexOf(a.season) - seasonOrder.indexOf(b.season);
	}
	return a.day - b.day;
}

/**
 * Convert a GameDate to a linear day count for arithmetic.
 */
export function dateToDays(date: GameDate, seasonOrder: string[], daysPerSeason: number): number {
	const seasonIndex = seasonOrder.indexOf(date.season);
	return date.year * seasonOrder.length * daysPerSeason + seasonIndex * daysPerSeason + date.day;
}

/**
 * Convert a linear day count back to a GameDate.
 */
export function daysToDate(days: number, seasonOrder: string[], daysPerSeason: number): GameDate {
	const totalDaysPerYear = seasonOrder.length * daysPerSeason;
	const year = Math.floor(days / totalDaysPerYear);
	const remainder = days - year * totalDaysPerYear;
	const seasonIndex = Math.floor(remainder / daysPerSeason);
	const day = remainder - seasonIndex * daysPerSeason;
	return { year, season: seasonOrder[seasonIndex] ?? seasonOrder[0], day: Math.max(1, day) };
}

export interface TimelineEntry {
	id: string;
	date: GameDate;
	characterId: string;
	eventTemplateId: string;
	choicesMade: string[];
	consequences: Array<{ type: string; target: string; value: number | string | boolean }>;
	summary: string;
}

export interface FactionState {
	id: string;
	mood: number;
}

export interface QuestlineProgress {
	questlineId: string;
	currentStageIndex: number;
	counters: Record<string, number>;
}

export interface WorldState {
	config: import('./blocks').WorldConfig;
	characters: Character[];
	timeline: TimelineEntry[];
	factions: FactionState[];
	questlineProgress: QuestlineProgress[];
	locations: LocationInstance[];
	playedCharacterIds: string[];
}

export interface LocationInstance {
	id: string;
	typeId: string;
	name: string;
	builtDate: GameDate;
	destroyedDate?: GameDate;
}
```

- [ ] **Step 2: Update blocks.ts — Consequence axis field, relationship_tag type, LocationType.natural**

In `src/lib/types/blocks.ts`, replace the `Consequence` interface:

```ts
export interface Consequence {
	type: 'stat' | 'faction' | 'questline' | 'world_fact' | 'relationship' | 'relationship_tag' | 'death' | 'exhaustion';
	target: string;
	value: number | string | boolean;
	axis?: string;
}
```

In the `LocationType` interface, add `natural`:

```ts
export interface LocationType {
	id: string;
	name: string;
	tags: string[];
	eventTags: string[];
	archetypeIds: string[];
	flavorTexts: string[];
	natural?: boolean;
}
```

- [ ] **Step 3: Update session.ts — timeContext and playedCharacterIds**

In `src/lib/types/session.ts`, update `PlaySession`:

```ts
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
```

- [ ] **Step 4: Verify types compile**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx tsc --noEmit
```

Expected: Type errors in tests and engine files that still use old `Record<string, number>` relationships and old `LocationInstance` without `builtDate`. This is expected — we fix those in the next tasks.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/
git commit -m "feat: update types — relationship vectors, location lifespans, session timeContext"
```

---

### Task 2: Fix Test Fixtures and Existing Tests

**Files:**
- Modify: `tests/fixtures/world-state.ts`
- Modify: `tests/fixtures/locations.ts`
- Modify: `tests/engine/choice-resolver.test.ts`
- Modify: `tests/engine/collapse.test.ts`

- [ ] **Step 1: Update location fixtures with builtDate**

In `tests/fixtures/locations.ts`, update `tavernInstance` and `marketInstance`:

```ts
export const tavernInstance: LocationInstance = {
	id: 'rusty_flagon',
	typeId: 'tavern',
	name: 'The Rusty Flagon',
	builtDate: { year: 830, season: 'spring', day: 1 }
};

export const marketInstance: LocationInstance = {
	id: 'market_square',
	typeId: 'market_quarter',
	name: 'Ironhaven Market Square',
	builtDate: { year: 800, season: 'spring', day: 1 }
};
```

- [ ] **Step 2: Update world-state fixtures with new relationship format**

In `tests/fixtures/world-state.ts`, update `elenaCharacter` and `marcusCharacter`:

```ts
export const elenaCharacter = {
	id: 'elena_blacksmith',
	name: 'Elena',
	archetypeId: 'blacksmith',
	traits: { strength: 7, cunning: 3, charisma: 5 },
	skills: ['forging', 'haggling'],
	locationId: 'market_square',
	factions: { town_guard: 5, craftsmen_guild: 7 },
	relationships: {},
	birthDate: { year: 820, season: 'spring', day: 12 },
	deathDate: null,
	alive: true
};

export const marcusCharacter = {
	id: 'marcus_merchant',
	name: 'Marcus',
	archetypeId: 'merchant',
	traits: { strength: 3, cunning: 7, charisma: 8 },
	skills: ['haggling', 'appraisal', 'navigation'],
	locationId: 'market_square',
	factions: { merchant_guild: 8 },
	relationships: {
		elena_blacksmith: { tags: ['trade_partner'], axes: { affection: 2, trust: 3 } }
	},
	birthDate: { year: 818, season: 'autumn', day: 5 },
	deathDate: null,
	alive: true
};
```

Update `createTestWorldState()` to include `playedCharacterIds: []`.

- [ ] **Step 3: Update choice-resolver tests for new relationship format**

In `tests/engine/choice-resolver.test.ts`, the `resolveChoice` test that checks relationship changes needs updating. The current test for "help bystander" checks `char.relationships[targetId]` as a number. Update to check `char.relationships[targetId].axes.affection`.

Find the test that creates a `deathChoice` and update any relationship assertions.

Also update `createTestSession()` to include `timeContext: 'present'`.

- [ ] **Step 4: Run all tests**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run
```

Expected: Some tests may still fail due to choice-resolver implementation still using old format. Note which tests fail — they'll be fixed in Task 3.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "feat: update test fixtures for relationship vectors and location lifespans"
```

---

### Task 3: Update Choice Resolver for Relationship Vectors

**Files:**
- Modify: `src/lib/engine/choice-resolver.ts`
- Modify: `tests/engine/choice-resolver.test.ts`

- [ ] **Step 1: Write new failing tests for axis-based relationships**

Add to `tests/engine/choice-resolver.test.ts`:

```ts
it('applies relationship consequence to specific axis', () => {
	const world = createTestWorldState();
	const session = createTestSession();
	const choice = {
		id: 'trust_choice', label: 'Build trust',
		consequences: [
			{ type: 'relationship' as const, target: 'marcus_merchant', value: 3, axis: 'trust' }
		],
		exhaustionCost: 1, nextNodeId: null
	};
	const result = resolveChoice(choice, session, world);
	const elena = result.world.characters.find(c => c.id === 'elena_blacksmith')!;
	expect(elena.relationships['marcus_merchant'].axes.trust).toBe(3);
});

it('defaults relationship axis to affection when unspecified', () => {
	const world = createTestWorldState();
	const session = createTestSession();
	const choice = {
		id: 'like_choice', label: 'Be nice',
		consequences: [
			{ type: 'relationship' as const, target: 'marcus_merchant', value: 2 }
		],
		exhaustionCost: 1, nextNodeId: null
	};
	const result = resolveChoice(choice, session, world);
	const elena = result.world.characters.find(c => c.id === 'elena_blacksmith')!;
	expect(elena.relationships['marcus_merchant'].axes.affection).toBe(2);
});

it('applies relationship_tag consequence', () => {
	const world = createTestWorldState();
	const session = createTestSession();
	const choice = {
		id: 'tag_choice', label: 'Befriend',
		consequences: [
			{ type: 'relationship_tag' as const, target: 'marcus_merchant', value: 'friend' }
		],
		exhaustionCost: 1, nextNodeId: null
	};
	const result = resolveChoice(choice, session, world);
	const elena = result.world.characters.find(c => c.id === 'elena_blacksmith')!;
	expect(elena.relationships['marcus_merchant'].tags).toContain('friend');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/engine/choice-resolver.test.ts
```

- [ ] **Step 3: Update choice-resolver.ts**

Replace the `'relationship'` case in `applyConsequence`:

```ts
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
```

- [ ] **Step 4: Run all tests**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/choice-resolver.ts tests/engine/choice-resolver.test.ts
git commit -m "feat: update choice resolver for axis-based relationships and relationship_tag consequences"
```

---

### Task 4: Timeline Engine — Date Utilities and World Snapshot

**Files:**
- Create: `src/lib/engine/timeline.ts`
- Create: `tests/engine/timeline.test.ts`

- [ ] **Step 1: Write failing tests for date utilities**

Create `tests/engine/timeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dateToDays, daysToDate, compareDates } from '../../src/lib/types/state';
import { createWorldSnapshotAt } from '../../src/lib/engine/timeline';
import { createTestWorldState, elenaCharacter, marcusCharacter } from '../fixtures/world-state';
import { allQuestlines } from '../fixtures/questlines';
import type { GameDate, Character, LocationInstance } from '../../src/lib/types/state';

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
		expect(autumn).toBeGreaterThan(spring);
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
		expect(compareDates(
			{ year: 845, season: 'spring', day: 1 },
			{ year: 846, season: 'spring', day: 1 },
			SEASONS
		)).toBeLessThan(0);
	});

	it('compares by season with season order', () => {
		expect(compareDates(
			{ year: 845, season: 'spring', day: 1 },
			{ year: 845, season: 'autumn', day: 1 },
			SEASONS
		)).toBeLessThan(0);
	});

	it('compares by day when year and season match', () => {
		expect(compareDates(
			{ year: 845, season: 'spring', day: 5 },
			{ year: 845, season: 'spring', day: 10 },
			SEASONS
		)).toBeLessThan(0);
	});
});

describe('createWorldSnapshotAt', () => {
	it('filters characters not yet born', () => {
		const world = createTestWorldState();
		// Elena born year 820, Marcus born year 818
		const snapshot = createWorldSnapshotAt(
			world,
			{ year: 819, season: 'spring', day: 1 },
			allQuestlines
		);
		const ids = snapshot.characters.map(c => c.id);
		expect(ids).toContain('marcus_merchant');
		expect(ids).not.toContain('elena_blacksmith');
	});

	it('filters dead characters after death date', () => {
		const world = createTestWorldState();
		world.characters[0].alive = false;
		world.characters[0].deathDate = { year: 840, season: 'summer', day: 15 };

		const beforeDeath = createWorldSnapshotAt(
			world,
			{ year: 839, season: 'spring', day: 1 },
			allQuestlines
		);
		expect(beforeDeath.characters.map(c => c.id)).toContain('elena_blacksmith');

		const afterDeath = createWorldSnapshotAt(
			world,
			{ year: 841, season: 'spring', day: 1 },
			allQuestlines
		);
		expect(afterDeath.characters.map(c => c.id)).not.toContain('elena_blacksmith');
	});

	it('filters locations not yet built', () => {
		const world = createTestWorldState();
		// market_square built year 800, rusty_flagon built year 830
		const snapshot = createWorldSnapshotAt(
			world,
			{ year: 825, season: 'spring', day: 1 },
			allQuestlines
		);
		const locationIds = snapshot.locations.map(l => l.id);
		expect(locationIds).toContain('market_square');
		expect(locationIds).not.toContain('rusty_flagon');
	});

	it('filters destroyed locations after destruction date', () => {
		const world = createTestWorldState();
		world.locations[0].destroyedDate = { year: 835, season: 'winter', day: 1 };

		const beforeDestruction = createWorldSnapshotAt(
			world,
			{ year: 834, season: 'spring', day: 1 },
			allQuestlines
		);
		expect(beforeDestruction.locations.map(l => l.id)).toContain('rusty_flagon');

		const afterDestruction = createWorldSnapshotAt(
			world,
			{ year: 836, season: 'spring', day: 1 },
			allQuestlines
		);
		expect(afterDestruction.locations.map(l => l.id)).not.toContain('rusty_flagon');
	});

	it('filters timeline entries to before target date', () => {
		const world = createTestWorldState();
		world.timeline = [
			{ id: 'e1', date: { year: 844, season: 'spring', day: 1 }, characterId: 'elena_blacksmith', eventTemplateId: 'market_day', choicesMade: [], consequences: [], summary: 'Early event' },
			{ id: 'e2', date: { year: 846, season: 'spring', day: 1 }, characterId: 'elena_blacksmith', eventTemplateId: 'market_day', choicesMade: [], consequences: [], summary: 'Later event' }
		];
		const snapshot = createWorldSnapshotAt(
			world,
			{ year: 845, season: 'spring', day: 1 },
			allQuestlines
		);
		expect(snapshot.timeline).toHaveLength(1);
		expect(snapshot.timeline[0].id).toBe('e1');
	});

	it('defaults questline to stage 0 when no timeline entries exist', () => {
		const world = createTestWorldState();
		const snapshot = createWorldSnapshotAt(
			world,
			{ year: 830, season: 'spring', day: 1 },
			allQuestlines
		);
		expect(snapshot.questlineProgress[0].currentStageIndex).toBe(0);
	});

	it('includes playedCharacterIds unchanged', () => {
		const world = createTestWorldState();
		world.playedCharacterIds = ['elena_blacksmith'];
		const snapshot = createWorldSnapshotAt(
			world,
			{ year: 845, season: 'spring', day: 1 },
			allQuestlines
		);
		expect(snapshot.playedCharacterIds).toEqual(['elena_blacksmith']);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/engine/timeline.test.ts
```

- [ ] **Step 3: Implement createWorldSnapshotAt**

Create `src/lib/engine/timeline.ts`:

```ts
import type { Questline } from '../types/blocks';
import type { WorldState, GameDate, Character, LocationInstance } from '../types/state';
import { compareDates, dateToDays, daysToDate } from '../types/state';

/**
 * Create a world state snapshot as it would have been at a given date.
 * Characters and locations are filtered by lifespan.
 * Timeline is filtered to entries at or before the target date.
 * Questline stage is reconstructed from timeline entries.
 * World facts and playedCharacterIds are preserved as-is (soft consistency).
 */
export function createWorldSnapshotAt(
	worldState: WorldState,
	targetDate: GameDate,
	questlines: Questline[]
): WorldState {
	const seasonOrder = worldState.config.dateSystem.seasons;

	// Filter characters: born before target, not dead before target
	const characters = worldState.characters.filter(c => {
		const bornBefore = compareDates(c.birthDate, targetDate, seasonOrder) <= 0;
		if (!bornBefore) return false;
		if (c.deathDate) {
			const deadBefore = compareDates(c.deathDate, targetDate, seasonOrder) <= 0;
			if (deadBefore) return false;
		}
		return true;
	});

	// Filter locations: built before target, not destroyed before target
	const locations = worldState.locations.filter(l => {
		const builtBefore = compareDates(l.builtDate, targetDate, seasonOrder) <= 0;
		if (!builtBefore) return false;
		if (l.destroyedDate) {
			const destroyedBefore = compareDates(l.destroyedDate, targetDate, seasonOrder) <= 0;
			if (destroyedBefore) return false;
		}
		return true;
	});

	// Filter timeline to entries at or before target date
	const timeline = worldState.timeline.filter(
		e => compareDates(e.date, targetDate, seasonOrder) <= 0
	);

	// Reconstruct questline progress from timeline
	const questlineProgress = worldState.questlineProgress.map(progress => {
		// For now, simple approach: use the stored progress if we're at or after the present,
		// otherwise default to stage 0 (can be refined with timeline-based reconstruction)
		const latestTimelineDate = worldState.timeline.length > 0
			? worldState.timeline[worldState.timeline.length - 1].date
			: null;

		if (latestTimelineDate && compareDates(targetDate, latestTimelineDate, seasonOrder) >= 0) {
			return { ...progress };
		}
		return { ...progress, currentStageIndex: 0, counters: {} };
	});

	// Reconstruct faction moods from initial + timeline consequences
	const factions = worldState.config.startingFactions.map(f => {
		let mood = f.initialMood;
		for (const entry of timeline) {
			for (const consequence of entry.consequences) {
				if (consequence.type === 'faction' && consequence.target === f.id && typeof consequence.value === 'number') {
					mood += consequence.value;
				}
			}
		}
		return { id: f.id, mood };
	});

	return {
		config: worldState.config,
		characters,
		timeline,
		factions,
		questlineProgress,
		locations,
		playedCharacterIds: [...worldState.playedCharacterIds]
	};
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/engine/timeline.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/timeline.ts tests/engine/timeline.test.ts
git commit -m "feat: implement world snapshot function — date-filtered characters, locations, timeline"
```

---

### Task 5: Timeline Engine — Date Generation

**Files:**
- Modify: `src/lib/engine/timeline.ts`
- Modify: `tests/engine/timeline.test.ts`

- [ ] **Step 1: Write failing tests for date generation**

Add to `tests/engine/timeline.test.ts`:

```ts
import { generatePastDate, generateFutureDate } from '../../src/lib/engine/timeline';

describe('generatePastDate', () => {
	it('returns a date between birth and current date', () => {
		const world = createTestWorldState();
		const elena = world.characters[0];
		const currentDate: GameDate = { year: 845, season: 'spring', day: 1 };

		const pastDate = generatePastDate(elena, currentDate, world.config.dateSystem);

		const seasonOrder = world.config.dateSystem.seasons;
		expect(compareDates(pastDate, elena.birthDate, seasonOrder)).toBeGreaterThanOrEqual(0);
		expect(compareDates(pastDate, currentDate, seasonOrder)).toBeLessThan(0);
	});

	it('returns different dates on multiple calls (probabilistic)', () => {
		const world = createTestWorldState();
		const elena = world.characters[0];
		const currentDate: GameDate = { year: 845, season: 'spring', day: 1 };

		const dates = new Set<number>();
		for (let i = 0; i < 20; i++) {
			const d = generatePastDate(elena, currentDate, world.config.dateSystem);
			dates.add(dateToDays(d, SEASONS, DAYS_PER_SEASON));
		}
		// With 25 years of range and 20 samples, we should get at least 2 different dates
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
		const seasonOrder = world.config.dateSystem.seasons;
		expect(compareDates(futureDate!, currentDate, seasonOrder)).toBeGreaterThan(0);
	});

	it('returns null for dead characters', () => {
		const world = createTestWorldState();
		const elena = { ...world.characters[0], alive: false, deathDate: { year: 840, season: 'summer', day: 1 } };

		const futureDate = generateFutureDate(elena, { year: 845, season: 'spring', day: 1 }, world.config.dateSystem);

		expect(futureDate).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/engine/timeline.test.ts
```

- [ ] **Step 3: Implement date generation functions**

Add to `src/lib/engine/timeline.ts`:

```ts
import type { DateSystem } from '../types/blocks';

/**
 * Generate a weighted random past date between the character's birth and the current date.
 * Dates near timeline entries get 3x weight, near questline transitions get 5x weight.
 */
export function generatePastDate(
	character: Character,
	currentDate: GameDate,
	dateSystem: DateSystem,
	timeline?: WorldState['timeline']
): GameDate {
	const { seasons, daysPerSeason } = dateSystem;
	const startDays = dateToDays(character.birthDate, seasons, daysPerSeason);
	const endDays = dateToDays(currentDate, seasons, daysPerSeason) - 1;

	if (endDays <= startDays) {
		return character.birthDate;
	}

	return weightedRandomDate(startDays, endDays, seasons, daysPerSeason, timeline);
}

/**
 * Generate a weighted random future date after the current date.
 * Returns null if the character is dead.
 */
export function generateFutureDate(
	character: Character,
	currentDate: GameDate,
	dateSystem: DateSystem,
	timeline?: WorldState['timeline'],
	maxYearsAhead: number = 20
): GameDate | null {
	if (!character.alive) return null;

	const { seasons, daysPerSeason } = dateSystem;
	const startDays = dateToDays(currentDate, seasons, daysPerSeason) + 1;
	const endDays = startDays + maxYearsAhead * seasons.length * daysPerSeason;

	return weightedRandomDate(startDays, endDays, seasons, daysPerSeason, timeline);
}

/**
 * Pick a random date in a day range, weighted toward timeline entries.
 */
function weightedRandomDate(
	startDays: number,
	endDays: number,
	seasonOrder: string[],
	daysPerSeason: number,
	timeline?: WorldState['timeline']
): GameDate {
	// Build weight array — base weight 1, bonus near timeline entries
	const range = endDays - startDays;
	if (range <= 0) return daysToDate(startDays, seasonOrder, daysPerSeason);

	// Simple weighted approach: collect timeline entry days for proximity bonus
	const timelineDays = new Set<number>();
	if (timeline) {
		for (const entry of timeline) {
			timelineDays.add(dateToDays(entry.date, seasonOrder, daysPerSeason));
		}
	}

	// Weighted random: try a few candidates and pick with weight bias
	let bestDay = startDays + Math.floor(Math.random() * range);
	let bestWeight = 1;

	for (let attempt = 0; attempt < 10; attempt++) {
		const candidateDay = startDays + Math.floor(Math.random() * range);
		let weight = 1;

		// Check proximity to timeline entries
		for (const tDay of timelineDays) {
			const distance = Math.abs(candidateDay - tDay);
			if (distance <= 5) weight *= 3;
			else if (distance <= 15) weight *= 1.5;
		}

		if (weight > bestWeight || (weight === bestWeight && Math.random() > 0.5)) {
			bestDay = candidateDay;
			bestWeight = weight;
		}
	}

	return daysToDate(bestDay, seasonOrder, daysPerSeason);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/engine/timeline.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/timeline.ts tests/engine/timeline.test.ts
git commit -m "feat: implement date generation — weighted random past/future dates"
```

---

### Task 6: Timeline Engine — Character Suggestions

**Files:**
- Modify: `src/lib/engine/timeline.ts`
- Modify: `tests/engine/timeline.test.ts`

- [ ] **Step 1: Write failing tests for suggestCharacters**

Add to `tests/engine/timeline.test.ts`:

```ts
import { suggestCharacters } from '../../src/lib/engine/timeline';
import type { Relationship } from '../../src/lib/types/state';

describe('suggestCharacters', () => {
	it('returns exactly 3 suggestions', () => {
		const world = createTestWorldState();
		world.playedCharacterIds = ['elena_blacksmith'];

		const suggestions = suggestCharacters('elena_blacksmith', world, ['elena_blacksmith']);
		expect(suggestions).toHaveLength(3);
	});

	it('includes a relationship-based suggestion when relationships exist', () => {
		const world = createTestWorldState();
		world.playedCharacterIds = ['elena_blacksmith'];
		// Give Elena a strong relationship with Marcus
		const elenaIdx = world.characters.findIndex(c => c.id === 'elena_blacksmith');
		world.characters[elenaIdx].relationships['marcus_merchant'] = {
			tags: [],
			axes: { rivalry: 8 }
		};

		const suggestions = suggestCharacters('elena_blacksmith', world, ['elena_blacksmith']);
		const characterSuggestions = suggestions.filter(s => s.type === 'existing');
		const ids = characterSuggestions.map(s => s.characterId);
		expect(ids).toContain('marcus_merchant');
	});

	it('always includes a "someone new" option as the third suggestion', () => {
		const world = createTestWorldState();
		world.playedCharacterIds = ['elena_blacksmith'];

		const suggestions = suggestCharacters('elena_blacksmith', world, ['elena_blacksmith']);
		expect(suggestions[2].type).toBe('new');
	});

	it('suggests descendants when a played character is dead', () => {
		const world = createTestWorldState();
		// Kill Elena
		world.characters[0].alive = false;
		world.characters[0].deathDate = { year: 840, season: 'summer', day: 1 };
		// Add a child of Elena
		world.characters.push({
			id: 'thora_blacksmith',
			name: 'Thora',
			archetypeId: 'blacksmith',
			traits: { strength: 6, cunning: 4, charisma: 5 },
			skills: ['forging'],
			locationId: 'market_square',
			factions: { craftsmen_guild: 5 },
			relationships: {
				elena_blacksmith: { tags: ['family:parent'], axes: { affection: 7 } }
			},
			parentId: 'elena_blacksmith',
			birthDate: { year: 838, season: 'spring', day: 1 },
			deathDate: null,
			alive: true
		});
		world.playedCharacterIds = ['elena_blacksmith'];

		const suggestions = suggestCharacters('elena_blacksmith', world, ['elena_blacksmith']);
		const existingSuggestions = suggestions.filter(s => s.type === 'existing');
		const ids = existingSuggestions.map(s => s.characterId);
		expect(ids).toContain('thora_blacksmith');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/engine/timeline.test.ts
```

- [ ] **Step 3: Implement suggestCharacters**

Add to `src/lib/engine/timeline.ts`:

```ts
export interface CharacterSuggestion {
	type: 'existing' | 'new';
	characterId?: string;
	characterName?: string;
	archetypeId?: string;
	contextLine: string;
}

/**
 * Suggest 3 characters for "Someone Else":
 * 1. Relationship extreme — character with most extreme axis value to any played character
 * 2. Family/situational — descendant of played character, or someone in an interesting spot
 * 3. Someone New — create a new character
 */
export function suggestCharacters(
	currentCharacterId: string,
	worldState: WorldState,
	playedCharacterIds: string[]
): CharacterSuggestion[] {
	const suggestions: CharacterSuggestion[] = [];
	const usedIds = new Set<string>([currentCharacterId]);

	// 1. Relationship extreme
	const relationshipSuggestion = findRelationshipExtreme(worldState, playedCharacterIds, usedIds);
	if (relationshipSuggestion) {
		suggestions.push(relationshipSuggestion);
		usedIds.add(relationshipSuggestion.characterId!);
	}

	// 2. Family or situational
	const familySuggestion = findFamilyOrSituational(worldState, playedCharacterIds, usedIds);
	if (familySuggestion) {
		suggestions.push(familySuggestion);
		usedIds.add(familySuggestion.characterId!);
	}

	// Fill remaining slots with living characters not yet suggested
	while (suggestions.length < 2) {
		const candidate = worldState.characters.find(c => c.alive && !usedIds.has(c.id));
		if (candidate) {
			suggestions.push({
				type: 'existing',
				characterId: candidate.id,
				characterName: candidate.name,
				archetypeId: candidate.archetypeId,
				contextLine: `A ${candidate.archetypeId} in ${candidate.locationId || 'the area'}`
			});
			usedIds.add(candidate.id);
		} else {
			break;
		}
	}

	// 3. Always: Someone New
	suggestions.push({
		type: 'new',
		contextLine: 'A stranger in troubled times'
	});

	return suggestions;
}

function findRelationshipExtreme(
	worldState: WorldState,
	playedCharacterIds: string[],
	excludeIds: Set<string>
): CharacterSuggestion | null {
	let bestChar: Character | null = null;
	let bestValue = 0;
	let bestAxis = '';

	for (const playedId of playedCharacterIds) {
		const played = worldState.characters.find(c => c.id === playedId);
		if (!played) continue;

		for (const [targetId, relationship] of Object.entries(played.relationships)) {
			if (excludeIds.has(targetId)) continue;
			const target = worldState.characters.find(c => c.id === targetId && c.alive);
			if (!target) continue;

			for (const [axis, value] of Object.entries(relationship.axes)) {
				if (Math.abs(value) > bestValue) {
					bestValue = Math.abs(value);
					bestChar = target;
					bestAxis = axis;
				}
			}
		}
	}

	if (!bestChar) return null;

	const descriptor = bestValue > 0
		? `Strong ${bestAxis} bond`
		: `Deep ${bestAxis} tension`;

	return {
		type: 'existing',
		characterId: bestChar.id,
		characterName: bestChar.name,
		archetypeId: bestChar.archetypeId,
		contextLine: `${descriptor} with a character you've played`
	};
}

function findFamilyOrSituational(
	worldState: WorldState,
	playedCharacterIds: string[],
	excludeIds: Set<string>
): CharacterSuggestion | null {
	// Look for family connections to played characters
	for (const char of worldState.characters) {
		if (!char.alive || excludeIds.has(char.id)) continue;

		for (const playedId of playedCharacterIds) {
			const relationship = char.relationships[playedId];
			if (!relationship) continue;

			const familyTag = relationship.tags.find(t => t.startsWith('family:'));
			if (familyTag) {
				const played = worldState.characters.find(c => c.id === playedId);
				const playedName = played?.name ?? 'a character you played';
				return {
					type: 'existing',
					characterId: char.id,
					characterName: char.name,
					archetypeId: char.archetypeId,
					contextLine: `${familyTag.replace('family:', '')} of ${playedName}`
				};
			}
		}
	}

	// Fallback: pick a living character in a different location
	for (const char of worldState.characters) {
		if (!char.alive || excludeIds.has(char.id)) continue;
		return {
			type: 'existing',
			characterId: char.id,
			characterName: char.name,
			archetypeId: char.archetypeId,
			contextLine: `A ${char.archetypeId} elsewhere in the world`
		};
	}

	return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/engine/timeline.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/timeline.ts tests/engine/timeline.test.ts
git commit -m "feat: implement character suggestions — relationship extremes, family, and new character options"
```

---

### Task 7: Collapse Engine — Lineage Creation

**Files:**
- Modify: `src/lib/engine/collapse.ts`
- Modify: `tests/engine/collapse.test.ts`

- [ ] **Step 1: Write failing test for lineage creation**

Add to `tests/engine/collapse.test.ts`:

```ts
import type { Character } from '../../src/lib/types/state';

describe('lineage creation', () => {
	it('may link new character as child of dead character with same archetype', () => {
		const world = createTestWorldState();
		// Kill Elena (blacksmith)
		world.characters[0].alive = false;
		world.characters[0].deathDate = { year: 840, season: 'summer', day: 1 };

		// Force creation by excluding all alive characters
		const bystander = banditRaid.roles[1]; // archetypeFilter: merchant, blacksmith
		const result = collapseRole(bystander, world.characters, allArchetypes, ['marcus_merchant']);

		expect(result.wasNewlyCreated).toBe(true);
		// The new character may or may not have lineage (30% chance), so just check the character exists
		expect(result.newCharacter).toBeDefined();
		if (result.newCharacter?.parentId) {
			expect(result.newCharacter.parentId).toBe('elena_blacksmith');
			expect(result.newCharacter.relationships['elena_blacksmith']).toBeDefined();
			expect(result.newCharacter.relationships['elena_blacksmith'].tags).toContain('family:parent');
		}
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/engine/collapse.test.ts
```

- [ ] **Step 3: Update collapse.ts for lineage**

In `instantiateFromArchetype`, after creating the character, add lineage logic:

```ts
function instantiateFromArchetype(
	archetypes: Archetype[],
	role: Role,
	existingCharacters?: Character[]
): { character: Character; name: string } {
	// ... existing archetype selection and trait generation ...

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

	// Lineage: 30% chance to link as child of a dead character with same archetype
	if (existingCharacters && Math.random() < 0.3) {
		const deadAncestor = existingCharacters.find(
			c => !c.alive && c.archetypeId === archetype.id
		);
		if (deadAncestor) {
			character.parentId = deadAncestor.id;
			character.relationships[deadAncestor.id] = {
				tags: ['family:parent'],
				axes: { affection: 5, respect: 3 }
			};
			// Inherit trait tendencies (±2 from parent)
			for (const [trait, value] of Object.entries(deadAncestor.traits)) {
				if (trait in character.traits) {
					const offset = Math.floor(Math.random() * 5) - 2; // -2 to +2
					character.traits[trait] = Math.max(1, Math.min(10, value + offset));
				}
			}
			// Set birth date 15-40 years after parent's birth
			const yearsAfter = 15 + Math.floor(Math.random() * 26);
			character.birthDate = {
				year: deadAncestor.birthDate.year + yearsAfter,
				season: deadAncestor.birthDate.season,
				day: deadAncestor.birthDate.day
			};
		}
	}

	return { character, name };
}
```

Update `collapseRole` to pass `characters` to `instantiateFromArchetype`:

```ts
const { character, name } = instantiateFromArchetype(archetypes, role, characters);
```

- [ ] **Step 4: Run all tests**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/collapse.ts tests/engine/collapse.test.ts
git commit -m "feat: add lineage creation — new characters may link as children of dead ancestors"
```

---

### Task 8: World Loader Migration

**Files:**
- Modify: `src/lib/engine/world-loader.ts`

- [ ] **Step 1: Add migration logic for old relationship format**

In `src/lib/engine/world-loader.ts`, update `loadWorldState` to migrate old relationship format:

```ts
import type { Relationship } from '../types/state';

/**
 * Migrate old Record<string, number> relationships to new Relationship format.
 */
function migrateRelationships(character: any): void {
	if (!character.relationships) return;
	for (const [targetId, value] of Object.entries(character.relationships)) {
		if (typeof value === 'number') {
			character.relationships[targetId] = {
				tags: [],
				axes: { affection: value }
			} satisfies Relationship;
		}
	}
}

/**
 * Migrate old LocationInstance without builtDate.
 */
function migrateLocation(location: any, startYear: number): void {
	if (!location.builtDate) {
		location.builtDate = { year: startYear, season: 'spring', day: 1 };
	}
}

export function loadWorldState(): WorldState | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	const state = JSON.parse(raw) as WorldState;

	// Migrate old formats
	for (const character of state.characters) {
		migrateRelationships(character);
	}
	const startYear = state.config?.dateSystem?.startYear ?? 845;
	for (const location of state.locations) {
		migrateLocation(location, startYear);
	}
	if (!state.playedCharacterIds) {
		state.playedCharacterIds = [];
	}

	return state;
}
```

- [ ] **Step 2: Verify types compile**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/engine/world-loader.ts
git commit -m "feat: add migration logic for old relationship format and location lifespans"
```

---

### Task 9: Navigation Store

**Files:**
- Create: `src/lib/stores/navigation.ts`

- [ ] **Step 1: Create navigation store**

Create `src/lib/stores/navigation.ts`:

```ts
import { writable } from 'svelte/store';
import type { GameDate } from '../types/state';
import type { CharacterSuggestion } from '../engine/timeline';

/** Navigation context passed from session-end to setup page */
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/stores/navigation.ts
git commit -m "feat: add navigation store for passing context between session-end and setup pages"
```

---

### Task 10: Session-End Page — Enable Timeline Navigation

**Files:**
- Modify: `src/routes/session-end/+page.svelte`

- [ ] **Step 1: Update session-end page**

The session-end page needs significant changes. The three disabled "Next Entry" buttons become functional:

- Import `generatePastDate`, `generateFutureDate`, `suggestCharacters`, `createWorldSnapshotAt` from `$lib/engine/timeline`
- Import `navigationContext` from `$lib/stores/navigation`
- Import `worldBlocks` from `$lib/stores/world`
- Add `$state` for `showingSuggestions` (boolean) and `suggestions` (CharacterSuggestion[])

**"The Past" button:**
- Enabled when character's birthDate < session date
- `onclick`: call `generatePastDate`, set `navigationContext` with `mode: 'pre-selected'`, character ID, target date, `timeContext: 'past'`, navigate to `/journal/setup`

**"The Future" button:**
- Enabled when character is alive (not `session.isDead`)
- Disabled text: "This character's story has ended"
- `onclick`: call `generateFutureDate`, set `navigationContext`, navigate to `/journal/setup`

**"Someone Else" button:**
- Always enabled
- `onclick`: call `suggestCharacters`, set `showingSuggestions = true`, render suggestion cards inline
- Each suggestion card shows name, archetype, context line
- Clicking an existing suggestion: set `navigationContext` with that character, navigate to `/journal/setup`
- Clicking "Someone New": set `navigationContext` with `mode: 'new'`, navigate to `/journal/setup`

Save the current world state before navigating (so the setup page has the latest state including this session's changes).

Also: after saving, add the current character to `worldState.playedCharacterIds` if not already there.

- [ ] **Step 2: Verify the page renders**

```bash
eval "$(direnv export bash 2>/dev/null)" && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/session-end/+page.svelte
git commit -m "feat: enable timeline navigation buttons — past, future, someone else"
```

---

### Task 11: Setup Page — Pre-Selected Character Mode

**Files:**
- Modify: `src/routes/journal/setup/+page.svelte`

- [ ] **Step 1: Update setup page for dual mode**

The setup page needs to support two modes:

1. **New character mode (existing)** — archetype selection, day-type prefs, create character
2. **Pre-selected character mode (new)** — shows existing character info, day-type prefs, uses world snapshot

Read `navigationContext` store on mount:
- If `mode === 'pre-selected'`: look up the character from `worldState`, show their name/archetype/traits, show the target date, skip archetype selection
- If `mode === 'new'`: show existing archetype selection flow

When "Begin the Day" is clicked in pre-selected mode:
- If `navigationContext.targetDate` exists, call `createWorldSnapshotAt` to build the date-appropriate world state
- Set the snapshot as the active `worldState`
- Create a `PlaySession` with the pre-selected character, target date, and `timeContext` from navigation context
- Navigate to `/journal`

Show the time context visually — a small badge like "The Past — Year 825" or "The Future — Year 860" at the top of the page.

- [ ] **Step 2: Verify build**

```bash
eval "$(direnv export bash 2>/dev/null)" && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/journal/setup/+page.svelte
git commit -m "feat: add pre-selected character mode to setup page for timeline navigation"
```

---

### Task 12: Update Demo World Events

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Update demo world events with axis-based relationship consequences**

In the `getDemoWorldBlocks()` function, update event consequences that use `type: 'relationship'` to include `axis` fields:

- Bandit raid "help_bystander": `{ type: 'relationship', target: '{bystander.id}', value: 3, axis: 'trust' }`
- Bandit raid "comfort": `{ type: 'relationship', target: '{bystander.id}', value: 2, axis: 'affection' }`
- Traveler arrives: add `axis: 'trust'` to help consequences, `axis: 'affection'` to comfort

Also update location instances in `initializeWorldState` calls or in the landing page to include `builtDate`:
- Tavern: `builtDate: { year: 830, season: 'spring', day: 1 }`
- Market Quarter: `builtDate: { year: 800, season: 'spring', day: 1 }`

Also update the landing page's `startNewWorld` to initialize `playedCharacterIds: []` on the world state.

- [ ] **Step 2: Verify build**

```bash
eval "$(direnv export bash 2>/dev/null)" && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: update demo world events with axis-based relationships and location builtDates"
```

---

### Task 13: Integration Check

- [ ] **Step 1: Run full test suite**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Type check**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Build static site**

```bash
eval "$(direnv export bash 2>/dev/null)" && npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test**

```bash
eval "$(direnv export bash 2>/dev/null)" && npm run dev -- --port 5173
```

Verify:
- Start a new world → setup page → play a journal entry → session end
- "The Past" button is enabled → click → goes to setup with pre-selected character and past date
- "The Future" button is enabled → click → goes to setup with future date
- "Someone Else" → shows 3 suggestions → click one → goes to setup with that character
- "Someone New" → goes to setup with archetype selection
- Kill a character (if possible with events) → "The Future" is disabled

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: integration check — all tests, types, and build pass"
```
