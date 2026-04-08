# Storyline-Based Session System - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace random event-chaining with a storyline-based session model: morning hook menu, single deep event per session, tension-driven escalation, and cross-session storyline continuity.

**Architecture:** New `storyline-manager.ts` engine module handles tension, escalation, and hook generation. New `/journal/morning` page presents hooks. Journal page simplified to single-event mode. EventTemplate gains storyline/chapter/escalation fields. WorldState gains storylineStates tracking.

**Tech Stack:** SvelteKit, TypeScript, Vitest (existing stack)

---

## File Structure

```
New:
  src/lib/types/storyline.ts           - StorylineState, Hook, EscalationConfig types
  src/lib/engine/storyline-manager.ts  - tension tracking, escalation, hook generation
  src/routes/journal/morning/+page.svelte - morning hook menu page
  tests/engine/storyline-manager.test.ts - tests for storyline engine

Modified:
  src/lib/types/blocks.ts              - add storyline/chapter/reentry_recap/escalation to EventTemplate
  src/lib/types/state.ts               - add storylineStates to WorldState
  src/lib/types/session.ts             - add selectedHook to PlaySession or navigation context
  src/routes/journal/+page.svelte      - remove event chaining, single event, wind-down
  src/routes/journal/setup/+page.svelte - route to /journal/morning after setup
  src/lib/engine/world-loader.ts       - migrate/handle storylineStates
  src/lib/git/repo-writer.ts           - serialize storylineStates
  src/lib/git/yaml-loader.ts           - load storylineStates from repo
  src/lib/stores/navigation.ts         - add hook selection context
  tests/fixtures/world-state.ts        - add storylineStates to fixtures
```

---

### Task 1: Storyline Types

**Files:**
- Create: `src/lib/types/storyline.ts`
- Modify: `src/lib/types/blocks.ts`
- Modify: `src/lib/types/state.ts`
- Modify: `tests/fixtures/world-state.ts`

- [ ] **Step 1: Create storyline types**

Create `src/lib/types/storyline.ts`:

```ts
import type { GameDate } from './state';

/** Persistent state for a storyline's tension and progress */
export interface StorylineState {
	currentChapter: number;
	tension: number;
	lastPlayerSession: string | null;
	lastEscalationDate: GameDate | null;
	npcDriverId: string | null;
}

/** Escalation config on an event template */
export interface EscalationConfig {
	chance_base: number;
	advances_to: string;
	world_facts_set: Record<string, string | number | boolean>;
}

/** A hook displayed in the morning menu */
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
```

- [ ] **Step 2: Update EventTemplate in blocks.ts**

Add to the `EventTemplate` interface:

```ts
export interface EventTemplate {
	id: string;
	name: string;
	tags: string[];
	preconditions: EventPrecondition[];
	roles: Role[];
	entryNodeId: string;
	nodes: Record<string, ChoiceNode>;
	storyline?: string;
	chapter?: number;
	reentry_recap?: string;
	escalation?: EscalationConfig;
}
```

Add the import at the top of blocks.ts:
```ts
import type { EscalationConfig } from './storyline';
```

- [ ] **Step 3: Update WorldState in state.ts**

Add `storylineStates` to `WorldState`:

```ts
export interface WorldState {
	config: import('./blocks').WorldConfig;
	characters: Character[];
	timeline: TimelineEntry[];
	factions: FactionState[];
	questlineProgress: QuestlineProgress[];
	locations: LocationInstance[];
	playedCharacterIds: string[];
	recentEventIds: string[];
	worldFacts: Record<string, string | number | boolean>;
	storylineStates: Record<string, import('./storyline').StorylineState>;
}
```

- [ ] **Step 4: Update test fixtures**

In `tests/fixtures/world-state.ts`, add `storylineStates: {}` to `createTestWorldState()`.

- [ ] **Step 5: Verify types compile**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/types/ tests/fixtures/
git commit -m "feat: add storyline types - StorylineState, Hook, EscalationConfig, EventTemplate extensions"
```

---

### Task 2: Storyline Manager Engine

**Files:**
- Create: `src/lib/engine/storyline-manager.ts`
- Create: `tests/engine/storyline-manager.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/engine/storyline-manager.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
	updateTension,
	escalateStorylines,
	generateHooks,
	tensionToUrgency
} from '../../src/lib/engine/storyline-manager';
import { createTestWorldState } from '../fixtures/world-state';
import type { EventTemplate } from '../../src/lib/types/blocks';
import type { StorylineState } from '../../src/lib/types/storyline';

describe('tensionToUrgency', () => {
	it('returns calm for 0-25', () => {
		expect(tensionToUrgency(0)).toBe('calm');
		expect(tensionToUrgency(25)).toBe('calm');
	});
	it('returns stirring for 26-50', () => {
		expect(tensionToUrgency(30)).toBe('stirring');
		expect(tensionToUrgency(50)).toBe('stirring');
	});
	it('returns urgent for 51-80', () => {
		expect(tensionToUrgency(60)).toBe('urgent');
	});
	it('returns critical for 81+', () => {
		expect(tensionToUrgency(90)).toBe('critical');
	});
});

describe('updateTension', () => {
	it('increases tension for unplayed storylines', () => {
		const state: StorylineState = {
			currentChapter: 1,
			tension: 10,
			lastPlayerSession: null,
			lastEscalationDate: null,
			npcDriverId: null
		};
		const updated = updateTension(state, false);
		expect(updated.tension).toBeGreaterThan(10);
		expect(updated.tension).toBeLessThanOrEqual(25); // 10 + max 15
	});

	it('increases faster for player-engaged storylines', () => {
		const engaged: StorylineState = {
			currentChapter: 1,
			tension: 10,
			lastPlayerSession: 'entry_123',
			lastEscalationDate: null,
			npcDriverId: null
		};
		const unengaged: StorylineState = {
			currentChapter: 1,
			tension: 10,
			lastPlayerSession: null,
			lastEscalationDate: null,
			npcDriverId: null
		};
		// Run many times to verify statistical tendency
		let engagedTotal = 0;
		let unengagedTotal = 0;
		for (let i = 0; i < 100; i++) {
			engagedTotal += updateTension(engaged, false).tension - 10;
			unengagedTotal += updateTension(unengaged, false).tension - 10;
		}
		expect(engagedTotal).toBeGreaterThan(unengagedTotal);
	});

	it('caps tension at 100', () => {
		const state: StorylineState = {
			currentChapter: 1,
			tension: 95,
			lastPlayerSession: null,
			lastEscalationDate: null,
			npcDriverId: null
		};
		const updated = updateTension(state, false);
		expect(updated.tension).toBeLessThanOrEqual(100);
	});

	it('does not increase for the currently played storyline', () => {
		const state: StorylineState = {
			currentChapter: 1,
			tension: 10,
			lastPlayerSession: 'entry_123',
			lastEscalationDate: null,
			npcDriverId: null
		};
		const updated = updateTension(state, true);
		expect(updated.tension).toBe(0); // reset
	});
});

describe('generateHooks', () => {
	it('returns hooks from eligible events', () => {
		const world = createTestWorldState();
		const events: EventTemplate[] = [
			{
				id: 'test_event',
				name: 'Test Event',
				tags: ['social'],
				preconditions: [],
				roles: [],
				entryNodeId: 'start',
				nodes: {
					start: {
						id: 'start',
						text: 'Something happens in the market today.',
						choices: []
					}
				}
			}
		];
		const hooks = generateHooks(events, world, 'spring', 'test_char', []);
		expect(hooks.length).toBeGreaterThan(0);
		expect(hooks[0].teaserText).toContain('Something happens');
	});

	it('groups storyline events and picks the most advanced chapter', () => {
		const world = createTestWorldState();
		world.storylineStates = {
			test_story: { currentChapter: 2, tension: 30, lastPlayerSession: null, lastEscalationDate: null, npcDriverId: null }
		};
		const events: EventTemplate[] = [
			{
				id: 'ch1', name: 'Chapter 1', tags: [], preconditions: [],
				roles: [], entryNodeId: 'start',
				nodes: { start: { id: 'start', text: 'Chapter 1 text.', choices: [] } },
				storyline: 'test_story', chapter: 1
			},
			{
				id: 'ch2', name: 'Chapter 2', tags: [], preconditions: [],
				roles: [], entryNodeId: 'start',
				nodes: { start: { id: 'start', text: 'Chapter 2 text.', choices: [] } },
				storyline: 'test_story', chapter: 2
			}
		];
		const hooks = generateHooks(events, world, 'spring', 'test_char', []);
		const storyHooks = hooks.filter(h => h.storyline === 'test_story');
		expect(storyHooks).toHaveLength(1);
		expect(storyHooks[0].eventId).toBe('ch2');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/engine/storyline-manager.test.ts
```

- [ ] **Step 3: Implement storyline-manager.ts**

Create `src/lib/engine/storyline-manager.ts`:

```ts
import type { EventTemplate, Questline } from '../types/blocks';
import type { WorldState, Character } from '../types/state';
import type { StorylineState, Hook, EscalationConfig } from '../types/storyline';
import { filterEvents } from './event-selector';
import { collapseAllRoles } from './collapse';
import { interpolateText } from './text-generator';

/**
 * Convert tension (0-100) to an urgency label.
 */
export function tensionToUrgency(tension: number): 'calm' | 'stirring' | 'urgent' | 'critical' {
	if (tension <= 25) return 'calm';
	if (tension <= 50) return 'stirring';
	if (tension <= 80) return 'urgent';
	return 'critical';
}

/**
 * Update tension for a single storyline.
 * If isCurrentlyPlayed is true, tension resets to 0 (player is driving it).
 */
export function updateTension(
	state: StorylineState,
	isCurrentlyPlayed: boolean
): StorylineState {
	if (isCurrentlyPlayed) {
		return { ...state, tension: 0 };
	}

	const baseDrift = 5 + Math.floor(Math.random() * 11); // 5-15
	const engagementMultiplier = state.lastPlayerSession ? 1.5 : 0.5;
	const increase = Math.round(baseDrift * engagementMultiplier);
	const newTension = Math.min(100, state.tension + increase);

	return { ...state, tension: newTension };
}

/**
 * Run escalation for all storylines. Called at session start.
 * Returns updated storyline states and any world facts that were set by NPC escalation.
 */
export function escalateStorylines(
	storylineStates: Record<string, StorylineState>,
	events: EventTemplate[],
	world: WorldState,
	playedStoryline?: string
): {
	updatedStates: Record<string, StorylineState>;
	newWorldFacts: Record<string, string | number | boolean>;
	escalatedStoryline: string | null;
	npcDriverId: string | null;
} {
	const updatedStates: Record<string, StorylineState> = {};
	const newWorldFacts: Record<string, string | number | boolean> = {};
	let escalatedStoryline: string | null = null;
	let npcDriverId: string | null = null;

	// First pass: update tension for all storylines
	for (const [name, state] of Object.entries(storylineStates)) {
		const isPlayed = name === playedStoryline;
		updatedStates[name] = updateTension(state, isPlayed);
	}

	// Also discover new storylines from events that have storyline fields but no state yet
	for (const event of events) {
		if (event.storyline && !updatedStates[event.storyline]) {
			updatedStates[event.storyline] = {
				currentChapter: 1,
				tension: 0,
				lastPlayerSession: null,
				lastEscalationDate: null,
				npcDriverId: null
			};
		}
	}

	// Second pass: check for threshold escalation (only one per session)
	let highestTension = 0;
	let highestStoryline: string | null = null;

	for (const [name, state] of Object.entries(updatedStates)) {
		if (name === playedStoryline) continue;
		if (state.tension >= 50 && state.tension > highestTension) {
			highestTension = state.tension;
			highestStoryline = name;
		}
	}

	if (highestStoryline) {
		const state = updatedStates[highestStoryline];
		// Find the current chapter's event to get escalation config
		const currentEvent = events.find(
			e => e.storyline === highestStoryline && e.chapter === state.currentChapter
		);

		if (currentEvent?.escalation) {
			const esc = currentEvent.escalation;
			// Set world facts from escalation
			for (const [key, value] of Object.entries(esc.world_facts_set)) {
				newWorldFacts[key] = value;
			}

			// Pick an NPC driver
			const aliveChars = world.characters.filter(c => c.alive);
			const driver = aliveChars[Math.floor(Math.random() * aliveChars.length)];

			// Advance the chapter
			updatedStates[highestStoryline] = {
				...state,
				currentChapter: state.currentChapter + 1,
				tension: 0,
				lastEscalationDate: null, // caller should set this to the session date
				npcDriverId: driver?.id ?? null
			};

			escalatedStoryline = highestStoryline;
			npcDriverId = driver?.id ?? null;
		}
	}

	return { updatedStates, newWorldFacts, escalatedStoryline, npcDriverId };
}

/**
 * Generate hooks for the morning menu.
 */
export function generateHooks(
	events: EventTemplate[],
	world: WorldState,
	currentSeason: string,
	characterId: string,
	questlines: Questline[]
): Hook[] {
	// Filter eligible events
	const eligible = filterEvents(events, world, currentSeason, questlines, characterId);

	// Group by storyline
	const storylineGroups: Record<string, EventTemplate[]> = {};
	const standalones: EventTemplate[] = [];

	for (const event of eligible) {
		if (event.storyline) {
			if (!storylineGroups[event.storyline]) storylineGroups[event.storyline] = [];
			storylineGroups[event.storyline].push(event);
		} else {
			standalones.push(event);
		}
	}

	const hooks: Hook[] = [];

	// For each storyline, pick the most advanced eligible chapter
	for (const [storyline, chapters] of Object.entries(storylineGroups)) {
		const state = world.storylineStates?.[storyline];
		const currentChapter = state?.currentChapter ?? 1;
		const tension = state?.tension ?? 0;

		// Pick the chapter closest to (but not exceeding) currentChapter
		const sorted = chapters
			.filter(e => (e.chapter ?? 1) <= currentChapter)
			.sort((a, b) => (b.chapter ?? 1) - (a.chapter ?? 1));

		const best = sorted[0];
		if (!best) continue;

		const teaserText = best.nodes[best.entryNodeId]?.text?.slice(0, 150) ?? best.name;
		const isContination = state?.lastPlayerSession !== null;

		hooks.push({
			eventId: best.id,
			storyline,
			chapter: best.chapter ?? null,
			teaserText,
			tension,
			urgency: tensionToUrgency(tension),
			isStorylineContinuation: isContination,
			reentryRecap: best.reentry_recap ?? null
		});
	}

	// Add standalone events as individual hooks
	// Pick up to 3 standalones randomly
	const shuffled = standalones.sort(() => Math.random() - 0.5);
	for (const event of shuffled.slice(0, 3)) {
		const teaserText = event.nodes[event.entryNodeId]?.text?.slice(0, 150) ?? event.name;
		hooks.push({
			eventId: event.id,
			storyline: null,
			chapter: null,
			teaserText,
			tension: 0,
			urgency: 'calm',
			isStorylineContinuation: false,
			reentryRecap: null
		});
	}

	// Sort: highest tension first
	hooks.sort((a, b) => b.tension - a.tension);

	return hooks;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run tests/engine/storyline-manager.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/storyline-manager.ts tests/engine/storyline-manager.test.ts
git commit -m "feat: implement storyline manager - tension tracking, escalation, hook generation"
```

---

### Task 3: Morning Menu Page

**Files:**
- Create: `src/routes/journal/morning/+page.svelte`
- Modify: `src/lib/stores/navigation.ts`

- [ ] **Step 1: Update navigation store to carry hook selection**

In `src/lib/stores/navigation.ts`, add a `selectedHook` field:

```ts
import type { Hook } from '../types/storyline';

export interface NavigationContext {
	mode: 'new' | 'pre-selected';
	characterId?: string;
	targetDate?: GameDate;
	timeContext: 'past' | 'present' | 'future';
	selectedHook?: Hook;
}
```

- [ ] **Step 2: Create the morning menu page**

Create `src/routes/journal/morning/+page.svelte`:

This page:
- On mount: loads world state, runs `escalateStorylines` to update tension, then calls `generateHooks` to build the menu
- Displays 2-6 hooks as cards, each showing: storyline name (or "Daily Life"), teaser text, tension indicator (colored badge: calm=green, stirring=yellow, urgent=orange, critical=red), chapter info if applicable
- Clicking a hook: sets `navigationContext.selectedHook`, navigates to `/journal`
- If a hook has `reentryRecap`, show it briefly before navigating
- Uses the parchment aesthetic
- Saves the updated storyline states to world state

Imports needed:
```ts
import { goto } from '$app/navigation';
import { base } from '$app/paths';
import { worldState, worldBlocks } from '$lib/stores/world';
import { playSession } from '$lib/stores/session';
import { navigationContext } from '$lib/stores/navigation';
import { githubState } from '$lib/stores/github';
import { escalateStorylines, generateHooks } from '$lib/engine/storyline-manager';
import { collapseAllRoles } from '$lib/engine/collapse';
import { interpolateText } from '$lib/engine/text-generator';
import { saveWorldState } from '$lib/engine/world-loader';
import type { Hook } from '$lib/types/storyline';
import type { PlaySession } from '$lib/types/session';
import { onMount } from 'svelte';
```

The page should:
1. Run escalation on mount
2. Generate hooks
3. Display hooks as clickable cards
4. On hook selection: collapse roles for the event, create the PlaySession, save to store, navigate to `/journal`

Urgency badges:
- calm: muted green border
- stirring: yellow border
- urgent: orange border
- critical: red border, pulsing animation

Svelte 5: `$state`, `$derived`, `onclick={handler}`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/journal/morning/ src/lib/stores/navigation.ts
git commit -m "feat: add morning menu page - hook display, tension indicators, storyline selection"
```

---

### Task 4: Journal Page Refactor - Single Event Mode

**Files:**
- Modify: `src/routes/journal/+page.svelte`

- [ ] **Step 1: Remove event chaining**

Read the current journal page. Remove:
- The `startNextEvent` function entirely
- The `playedEventIds` tracking
- The `TRANSITION_BEATS` array
- The transition beat rendering in narrative
- All calls to `startNextEvent` in `handleChoice`

In `handleChoice`, when `choice.nextNodeId === null`:
- Instead of calling `startNextEvent`, show a wind-down message
- If the player has exhaustion remaining, offer "There's still daylight. Continue?" which loops back to the event's entry node (or a hub node)
- Otherwise show "The day draws to a close" and a button to navigate to session-end

- [ ] **Step 2: Handle reentry recap**

On mount, if `navigationContext.selectedHook?.reentryRecap` exists, prepend it to the narrative before the first event node text.

- [ ] **Step 3: Remove recentEventIds staleness tracking**

Remove all references to `recentEventIds` in the journal page's save/rest handlers. Tension system replaces this.

- [ ] **Step 4: Commit**

```bash
git add src/routes/journal/+page.svelte
git commit -m "feat: refactor journal page - single event per session, wind-down instead of chaining"
```

---

### Task 5: Setup Page Routing Change

**Files:**
- Modify: `src/routes/journal/setup/+page.svelte`

- [ ] **Step 1: Route to morning menu after setup**

In `buildAndStartSession`, instead of navigating directly to `/journal`, navigate to `/journal/morning`. The morning page will handle event selection and PlaySession creation.

BUT: the morning page needs to know the character and date. Instead of creating the full PlaySession in setup, pass the character info and date via the navigation context, and let the morning page create the session after hook selection.

Update `buildAndStartSession` to NOT create a PlaySession. Instead:
- Set `worldState` with the character added
- Set `navigationContext` with characterId, date, timeContext
- Navigate to `${base}/journal/morning`

The morning page will read the navigation context, generate hooks for that character, and create the PlaySession when the player picks a hook.

- [ ] **Step 2: Commit**

```bash
git add src/routes/journal/setup/+page.svelte
git commit -m "feat: route setup page to morning menu instead of directly to journal"
```

---

### Task 6: World Loader + Git Integration

**Files:**
- Modify: `src/lib/engine/world-loader.ts`
- Modify: `src/lib/git/repo-writer.ts`
- Modify: `src/lib/git/yaml-loader.ts`

- [ ] **Step 1: Update world-loader.ts**

In `initializeWorldState`, add `storylineStates: {}`.

In `loadWorldState`, add migration:
```ts
if (!state.storylineStates) {
	(state as any).storylineStates = {};
}
```

- [ ] **Step 2: Update repo-writer.ts**

In `serializeWorldStateToFiles`, add:
```ts
files.set('state/storylines.yaml', yaml.dump(state.storylineStates ?? {}));
```

- [ ] **Step 3: Update yaml-loader.ts**

In `buildWorldStateFromFiles`, add:
```ts
const storylineStates = parseYamlContent<Record<string, StorylineState>>(
	files.get('state/storylines.yaml') ?? ''
) ?? {};
```

And include it in the returned WorldState.

- [ ] **Step 4: Commit**

```bash
git add src/lib/engine/world-loader.ts src/lib/git/repo-writer.ts src/lib/git/yaml-loader.ts
git commit -m "feat: add storylineStates to world loader, repo writer, and yaml loader"
```

---

### Task 7: Session-End Tension Updates

**Files:**
- Modify: `src/routes/session-end/+page.svelte`

- [ ] **Step 1: Update saveSession to manage tension**

In the `saveSession` function, after creating the timeline entry:
- Identify which storyline was played (from the session's event template)
- Reset tension for that storyline to 0
- Bump tension for all other storylines by +2 to +5 (small "world moved" increment)
- Update `storylineStates` in world state
- If the played event has a `storyline` field, update `lastPlayerSession` to the new timeline entry ID

This replaces the old `recentEventIds` tracking.

- [ ] **Step 2: Commit**

```bash
git add src/routes/session-end/+page.svelte
git commit -m "feat: update tension on session save - reset played storyline, bump others"
```

---

### Task 8: Integration Check

- [ ] **Step 1: Run full test suite**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx vitest run
```

- [ ] **Step 2: Type check**

```bash
eval "$(direnv export bash 2>/dev/null)" && npx tsc --noEmit
```

- [ ] **Step 3: Build**

```bash
eval "$(direnv export bash 2>/dev/null)" && npm run build
```

- [ ] **Step 4: Manual smoke test**

Verify:
- Start a session, morning menu appears with hooks
- Pick a hook, the journal shows the event
- Play through the event, no random event chains appear
- When event ends, wind-down appears instead of chaining
- Save, check that storylineStates updated
- Start another session, morning menu shows different hooks with updated tension

- [ ] **Step 5: Push**

```bash
git push
```
