# Session End Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the session-end page with split-panel layout (desktop), decision-first single column (mobile), implicit auto-save on all forward actions, and hook re-roll on undo.

**Architecture:** Four files change. `NavigationContext` gains a `forceReroll` field. The morning page reads it to randomize hook selection. The session-end page gets a complete template/style rewrite with two responsive layouts. Timeline disable logic adds a "no prior entries" check.

**Tech Stack:** SvelteKit 5, TypeScript, Vitest

---

### Task 1: Add `forceReroll` to NavigationContext

**Files:**
- Modify: `src/lib/stores/navigation.ts:5-11`

- [ ] **Step 1: Add the field to the interface**

In `src/lib/stores/navigation.ts`, add `forceReroll` as an optional boolean to `NavigationContext`:

```typescript
export interface NavigationContext {
	mode: 'new' | 'pre-selected';
	characterId?: string;
	targetDate?: GameDate;
	timeContext: 'past' | 'present' | 'future';
	selectedHook?: Hook;
	forceReroll?: boolean;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/navigation.ts
git commit -m "feat: add forceReroll to NavigationContext"
```

---

### Task 2: Add `canGoToPast` helper to timeline.ts

The session-end page needs to know whether "Backward in Time" should be disabled. Currently the page checks `compareDates(birthDate, currentDate)` inline. The spec adds a second condition: character has zero prior timeline entries. Extract this into a testable function.

**Files:**
- Modify: `src/lib/engine/timeline.ts`
- Modify: `tests/engine/timeline.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/engine/timeline.test.ts`:

```typescript
import { canGoToPast } from '../../src/lib/engine/timeline';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/engine/timeline.test.ts`
Expected: FAIL — `canGoToPast` is not exported.

- [ ] **Step 3: Implement `canGoToPast`**

Add to `src/lib/engine/timeline.ts`:

```typescript
export function canGoToPast(
	character: Character,
	currentDate: GameDate,
	seasons: string[],
	timeline: WorldState['timeline']
): boolean {
	const hasDateRange = compareDates(character.birthDate, currentDate, seasons) < 0;
	if (!hasDateRange) return false;
	const hasEntries = timeline.some(e => e.characterId === character.id);
	return hasEntries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/engine/timeline.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/timeline.ts tests/engine/timeline.test.ts
git commit -m "feat: add canGoToPast helper with timeline-entry check"
```

---

### Task 3: Implement hook re-roll in the morning page

When `forceReroll` is true, apply random tension offsets before generating hooks so the player sees different options.

**Files:**
- Modify: `src/routes/journal/morning/+page.svelte:65-113`

- [ ] **Step 1: Write the re-roll logic**

In the `onMount` callback of `src/routes/journal/morning/+page.svelte`, after the escalation step and before `generateHooks`, add re-roll logic. Replace the block from `// Determine season for hook generation` (line 98) through `hooks = generated;` (line 111) with:

```typescript
		// Determine season for hook generation
		const date = $navigationContext.targetDate ?? $playSession?.date;
		const season = date?.season ?? updatedState.config.dateSystem.seasons[0];

		// If forceReroll, randomize tension scores so hooks differ from last time
		let stateForHooks = updatedState;
		if ($navigationContext.forceReroll) {
			const randomizedStorylines = { ...(updatedState.storylineStates ?? {}) };
			for (const [name, slState] of Object.entries(randomizedStorylines)) {
				const offset = -20 + Math.floor(Math.random() * 41); // -20 to +20
				randomizedStorylines[name] = {
					...slState,
					tension: Math.max(0, Math.min(100, slState.tension + offset))
				};
			}
			stateForHooks = { ...updatedState, storylineStates: randomizedStorylines };
		}

		// Generate hooks
		const generated = generateHooks(
			savedBlocks.events,
			stateForHooks,
			season,
			charId,
			savedBlocks.questlines
		);

		hooks = generated;
```

Note: the randomized state is only used for hook generation — `updatedState` (with real tensions) was already saved to the world store and localStorage above. The re-roll doesn't permanently alter tension values.

- [ ] **Step 2: Clear the forceReroll flag after use**

At the end of the `onMount` callback, after `isLoading = false;` (line 112), add:

```typescript
		// Clear forceReroll so it doesn't persist to future navigations
		if ($navigationContext.forceReroll) {
			navigationContext.update(ctx => ({ ...ctx, forceReroll: false }));
		}
```

- [ ] **Step 3: Verify the app compiles**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/journal/morning/+page.svelte
git commit -m "feat: support forceReroll flag for hook re-generation"
```

---

### Task 4: Rewrite session-end page template and handlers

Complete rewrite of `src/routes/session-end/+page.svelte`. This is the largest task — new layout, new action grouping, new handlers, responsive behavior.

**Files:**
- Modify: `src/routes/session-end/+page.svelte` (full rewrite)

- [ ] **Step 1: Update the script block — imports and new derived state**

Replace the imports section (lines 1-15) with:

```typescript
<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { playSession, narrativeLog as narrativeLogStore } from '$lib/stores/session';
	import { saveWorldState, loadWorldState } from '$lib/engine/world-loader';
	import { generatePastDate, generateFutureDate, suggestCharacters, canGoToPast } from '$lib/engine/timeline';
	import { navigationContext } from '$lib/stores/navigation';
	import type { CharacterSuggestion } from '$lib/engine/timeline';
	import { githubState } from '$lib/stores/github';
	import { serializeWorldStateToFiles, saveWithPR, queuePendingChanges } from '$lib/git/repo-writer';
	import { formatJournalEntry, journalFilePath } from '$lib/git/journal-formatter';
	import { AuthExpiredError } from '$lib/git/auth-errors';
	import InvitesBadge from '$lib/components/InvitesBadge.svelte';
```

- [ ] **Step 2: Update derived state — replace `canGoToPast` inline check**

Replace the `canGoToPast` derived (lines 33-37) with:

```typescript
	let canGoToPastDerived = $derived(
		session && currentCharacter && state
			? canGoToPast(currentCharacter, session.date, state.config.dateSystem.seasons, state.timeline)
			: false
	);
```

Keep `canGoToFuture` as-is (lines 39-41).

- [ ] **Step 3: Add narrative expansion state**

Add after the `showingSuggestions` state (line 30):

```typescript
	let narrativeExpanded = $state(false);
```

- [ ] **Step 4: Replace action handlers**

Remove `handleSave`, `handleDiscardReplay`, `handleDiscardMenu`, `handlePast`, `handleFuture`, `handleSomeoneElse` (lines 207-279). Replace with:

```typescript
	// --- Keep this day actions (all auto-save) ---

	async function handleForward() {
		if (!session || !currentCharacter || !state) return;
		await saveSession();
		const futureDate = generateFutureDate(currentCharacter, session.date, state.config.dateSystem, state.timeline);
		if (!futureDate) return;
		navigationContext.set({
			mode: 'pre-selected',
			characterId: session.characterId,
			targetDate: futureDate,
			timeContext: 'future'
		});
		playSession.set(null);
		goto(`${base}/journal/setup`);
	}

	async function handleBackward() {
		if (!session || !currentCharacter || !state) return;
		await saveSession();
		const pastDate = generatePastDate(currentCharacter, session.date, state.config.dateSystem, state.timeline);
		navigationContext.set({
			mode: 'pre-selected',
			characterId: session.characterId,
			targetDate: pastDate,
			timeContext: 'past'
		});
		playSession.set(null);
		goto(`${base}/journal/setup`);
	}

	async function handleSomeoneElse() {
		if (!state || !session) return;
		await saveSession();
		suggestions = suggestCharacters(session.characterId, state, state.playedCharacterIds);
		showingSuggestions = true;
	}

	async function handleSaveAndMenu() {
		await saveSession();
		playSession.set(null);
		goto(`${base}/`);
	}

	// --- Toss this day actions (no save) ---

	function handleUndoRedo() {
		const saved = loadWorldState();
		if (saved) {
			worldState.set(saved);
		}
		if (session) {
			navigationContext.set({
				mode: 'pre-selected',
				characterId: session.characterId,
				targetDate: session.date,
				timeContext: session.timeContext,
				forceReroll: true
			});
		}
		playSession.set(null);
		goto(`${base}/journal/morning`);
	}

	function handleDiscardMenu() {
		const saved = loadWorldState();
		if (saved) {
			worldState.set(saved);
		}
		playSession.set(null);
		goto(`${base}/`);
	}
```

Keep the existing `selectSuggestion` function and `saveSession` function unchanged.

- [ ] **Step 5: Replace the template**

Replace everything from `<div class="session-end-page">` (line 282) through the closing `</div>` before `<style>` (line 409) with:

```svelte
<div class="session-end-page">
	<!-- Header -->
	<header class="session-end-header">
		<a href="{base}/" class="back-link">← Home</a>
		<h1 class="page-title">Journal Entry Complete</h1>
		<div class="sync-badge-wrap">
			<InvitesBadge />
			{#if syncStatus === 'syncing'}
				<span class="sync-badge sync-syncing">Syncing...</span>
			{:else if syncStatus === 'synced'}
				<span class="sync-badge sync-synced">Synced</span>
			{:else if syncStatus === 'pending'}
				<span class="sync-badge sync-pending">Pending</span>
			{:else if syncStatus === 'error'}
				<span class="sync-badge sync-error">Sync Error</span>
			{/if}
		</div>
	</header>

	<!-- Desktop: split panel / Mobile: single column -->
	<div class="session-end-body">
		<!-- Narrative panel (desktop: left side, mobile: collapsible at bottom) -->
		<div class="narrative-panel">
			<div class="narrative-panel-header">
				<h2 class="char-name">{currentCharacter?.name ?? 'Unknown Character'}</h2>
				<span class="entry-date">{dateDisplay()}</span>
			</div>
			<div class="narrative-panel-label">Full journal entry</div>
			<div class="narrative-text">
				{#if narrativeLog && narrativeLog.length > 0}
					{#each narrativeLog as entry}
						{#if entry.choiceLabel}
							<blockquote>{entry.text}</blockquote>
						{:else}
							<p>{entry.text}</p>
						{/if}
					{/each}
				{:else if session && session.choiceLog.length > 0}
					{#each session.choiceLog as record}
						{#if record.narrativeText}
							<p>{record.narrativeText}</p>
						{/if}
						<blockquote>{record.text}</blockquote>
					{/each}
				{:else if !session?.isDead}
					<p class="quiet-day">A quiet day passed without incident.</p>
				{/if}
				{#if session?.isDead}
					<div class="death-notice">
						<span class="death-icon">✦</span>
						<span>{currentCharacter?.name ?? 'This character'} did not survive this day.</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- Action sidebar (desktop: right side, mobile: main content area) -->
		<div class="action-sidebar">
			<!-- Mobile-only: compact identity + summary -->
			<div class="mobile-identity">
				<h2 class="char-name">{currentCharacter?.name ?? 'Unknown Character'}</h2>
				<span class="entry-date">{dateDisplay()}</span>
			</div>

			<div class="mobile-summary">
				<div class="section-label">What happened</div>
				<p class="summary-text">{sessionSummary()}</p>
				{#if session?.isDead}
					<div class="death-notice">
						<span class="death-icon">✦</span>
						<span>This character's story has ended.</span>
					</div>
				{/if}
			</div>

			<!-- Tags (both layouts) -->
			{#if choiceTags().length > 0}
				<div class="tags-section">
					<div class="section-label">This entry touched on</div>
					<div class="tags-list">
						{#each choiceTags() as tag}
							<span class="tag">{tag}</span>
						{/each}
					</div>
				</div>
			{/if}

			<div class="divider"></div>

			<!-- Keep this day -->
			{#if showingSuggestions}
				<div class="suggestions-section">
					<div class="section-label">Play as...</div>
					<div class="suggestions">
						{#each suggestions as suggestion}
							<button class="btn suggestion-card" onclick={() => selectSuggestion(suggestion)}>
								<span class="btn-title">
									{#if suggestion.type === 'new'}
										Someone New
									{:else}
										{suggestion.characterName} — {suggestion.archetypeId}
									{/if}
								</span>
								<span class="btn-sub">{suggestion.contextLine}</span>
							</button>
						{/each}
					</div>
				</div>
			{:else}
				<div class="keep-section">
					<div class="section-label">Keep this day and...</div>
					<div class="keep-grid">
						<button class="keep-btn" disabled={!canGoToFuture} onclick={handleForward}>
							<span class="keep-icon">→</span>
							<span class="keep-label">Forward in Time</span>
							<span class="keep-sub">
								{#if session?.isDead || (currentCharacter && !currentCharacter.alive)}
									Story has ended
								{:else}
									Continue later
								{/if}
							</span>
						</button>
						<button class="keep-btn" disabled={!canGoToPastDerived} onclick={handleBackward}>
							<span class="keep-icon">←</span>
							<span class="keep-label">Backward in Time</span>
							<span class="keep-sub">Revisit an earlier moment</span>
						</button>
						<button class="keep-btn" onclick={handleSomeoneElse}>
							<span class="keep-icon">⇄</span>
							<span class="keep-label">Play Another Character</span>
							<span class="keep-sub">Different eyes</span>
						</button>
						<button class="keep-btn" onclick={handleSaveAndMenu}>
							<span class="keep-icon">⌂</span>
							<span class="keep-label">Save & Menu</span>
							<span class="keep-sub">Done for now</span>
						</button>
					</div>
				</div>
			{/if}

			<div class="divider"></div>

			<!-- Toss this day -->
			<div class="toss-section">
				<div class="section-label">Toss this day</div>
				<div class="toss-row">
					<button class="toss-btn" onclick={handleUndoRedo}>
						<span class="toss-label">Undo & Redo</span>
						<span class="toss-sub">Re-roll hooks, start fresh</span>
					</button>
					<button class="toss-btn" onclick={handleDiscardMenu}>
						<span class="toss-label">Discard & Menu</span>
						<span class="toss-sub">Throw away, go home</span>
					</button>
				</div>
			</div>

			<!-- Mobile-only: expandable narrative -->
			<div class="divider mobile-narrative-divider"></div>
			<div class="mobile-narrative">
				<button class="narrative-toggle" onclick={() => narrativeExpanded = !narrativeExpanded} class:open={narrativeExpanded}>
					<span class="narrative-toggle-label">📖 Read the full journal entry</span>
					<span class="narrative-toggle-arrow">▼</span>
				</button>
				{#if narrativeExpanded}
					<div class="narrative-expand-body">
						{#if narrativeLog && narrativeLog.length > 0}
							{#each narrativeLog as entry}
								{#if entry.choiceLabel}
									<blockquote>{entry.text}</blockquote>
								{:else}
									<p>{entry.text}</p>
								{/if}
							{/each}
						{:else if session && session.choiceLog.length > 0}
							{#each session.choiceLog as record}
								{#if record.narrativeText}
									<p>{record.narrativeText}</p>
								{/if}
								<blockquote>{record.text}</blockquote>
							{/each}
						{:else if !session?.isDead}
							<p class="quiet-day">A quiet day passed without incident.</p>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
```

- [ ] **Step 6: Replace the styles**

Replace the entire `<style>` block with:

```css
<style>
	.session-end-page {
		min-height: 100vh;
		background-color: var(--session-end-bg);
		color: var(--session-end-text);
		font-family: var(--journal-font);
		display: flex;
		flex-direction: column;
	}

	/* ── Header ── */
	.session-end-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1.5rem;
		border-bottom: 1px solid var(--session-end-border);
		background: rgba(255, 255, 255, 0.03);
	}
	.back-link {
		color: var(--session-end-text);
		text-decoration: none;
		font-size: 0.85rem;
		opacity: 0.6;
		transition: opacity 0.15s;
		flex: 1;
	}
	.back-link:hover { opacity: 1; }
	.page-title {
		font-size: 1.1rem;
		font-weight: normal;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		opacity: 0.7;
		text-align: center;
		flex: 2;
	}
	.sync-badge-wrap {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.sync-badge {
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 0.2rem 0.55rem;
		border-radius: 3px;
		border: 1px solid transparent;
	}
	.sync-syncing { color: #9ab8e8; border-color: rgba(90, 140, 210, 0.4); background: rgba(90, 140, 210, 0.1); }
	.sync-synced { color: #8ecf8e; border-color: rgba(80, 160, 80, 0.4); background: rgba(80, 160, 80, 0.1); }
	.sync-pending { color: #d4b96a; border-color: rgba(180, 140, 60, 0.4); background: rgba(180, 140, 60, 0.1); }
	.sync-error { color: #e09090; border-color: rgba(180, 60, 60, 0.4); background: rgba(180, 60, 60, 0.1); }

	/* ── Split layout (desktop) ── */
	.session-end-body {
		flex: 1;
		display: flex;
		height: calc(100vh - 52px);
		overflow: hidden;
	}

	/* ── Narrative panel (left) ── */
	.narrative-panel {
		flex: 1;
		overflow-y: auto;
		padding: 2rem 2.5rem;
		border-right: 1px solid var(--session-end-border);
		background: rgba(0, 0, 0, 0.08);
	}
	.narrative-panel-header { margin-bottom: 1.5rem; }
	.narrative-panel-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		opacity: 0.4;
		margin-bottom: 1rem;
	}
	.char-name {
		font-size: 1.6rem;
		font-weight: normal;
		color: var(--journal-accent);
		margin-bottom: 0.25rem;
	}
	.entry-date {
		font-size: 0.82rem;
		opacity: 0.45;
		letter-spacing: 0.06em;
	}
	.narrative-text {
		line-height: 1.85;
		font-size: 0.95rem;
	}
	.narrative-text p {
		margin-bottom: 1.1rem;
		opacity: 0.85;
	}
	.narrative-text blockquote {
		border-left: 2px solid var(--journal-accent);
		padding-left: 1rem;
		margin: 0.85rem 0;
		color: var(--journal-accent);
		opacity: 0.9;
		font-style: italic;
	}
	.quiet-day { font-style: italic; opacity: 0.6; }

	/* ── Action sidebar (right) ── */
	.action-sidebar {
		width: 320px;
		min-width: 280px;
		overflow-y: auto;
		padding: 2rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ── Shared elements ── */
	.section-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		opacity: 0.4;
		margin-bottom: 0.5rem;
	}
	.divider { height: 1px; background: var(--session-end-border); opacity: 0.5; }
	.tags-list { display: flex; flex-wrap: wrap; gap: 0.4rem; }
	.tag {
		padding: 0.2rem 0.55rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--session-end-border);
		border-radius: 20px;
		font-size: 0.72rem;
		opacity: 0.7;
	}
	.death-notice {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
		color: #c07060;
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid rgba(192, 112, 96, 0.3);
		border-radius: 4px;
		background: rgba(192, 112, 96, 0.07);
	}
	.death-icon { font-size: 0.7rem; opacity: 0.75; }

	/* ── Keep grid ── */
	.keep-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.keep-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 1rem 0.65rem;
		background: rgba(139, 105, 20, 0.06);
		border: 1px solid rgba(139, 105, 20, 0.3);
		border-radius: 5px;
		cursor: pointer;
		color: var(--session-end-text);
		font-family: var(--journal-font);
		gap: 0.35rem;
		transition: background 0.15s, border-color 0.15s, transform 0.1s;
	}
	.keep-btn:hover:not(:disabled) {
		background: rgba(139, 105, 20, 0.15);
		border-color: var(--journal-accent);
		transform: translateY(-1px);
	}
	.keep-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.keep-icon {
		font-size: 1.3rem;
		color: var(--journal-accent);
		opacity: 0.8;
	}
	.keep-label {
		font-size: 0.82rem;
		color: var(--journal-accent);
	}
	.keep-sub {
		font-size: 0.68rem;
		opacity: 0.45;
		line-height: 1.4;
	}

	/* ── Toss row ── */
	.toss-row {
		display: flex;
		gap: 0.6rem;
	}
	.toss-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 0.55rem 0.5rem;
		background: transparent;
		border: 1px solid rgba(74, 74, 58, 0.35);
		border-radius: 4px;
		cursor: pointer;
		color: var(--session-end-text);
		font-family: var(--journal-font);
		opacity: 0.5;
		gap: 0.1rem;
		transition: opacity 0.15s, background 0.15s, border-color 0.15s;
	}
	.toss-btn:hover {
		opacity: 1;
		background: rgba(180, 60, 60, 0.08);
		border-color: rgba(180, 60, 60, 0.3);
	}
	.toss-label { font-size: 0.8rem; }
	.toss-sub { font-size: 0.65rem; opacity: 0.5; }

	/* ── Suggestions ── */
	.suggestions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.suggestion-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding: 0.75rem 1rem;
		background: rgba(139, 105, 20, 0.06);
		border: 1px solid rgba(139, 105, 20, 0.3);
		border-radius: 4px;
		cursor: pointer;
		font-family: var(--journal-font);
		color: var(--session-end-text);
		text-align: left;
		gap: 0.15rem;
		width: 100%;
		transition: background 0.15s, border-color 0.15s;
	}
	.suggestion-card:hover {
		border-color: var(--journal-accent);
		background: rgba(139, 105, 20, 0.12);
	}
	.btn-title { font-size: 0.9rem; color: var(--journal-accent); }
	.btn-sub { font-size: 0.72rem; opacity: 0.45; }

	/* ── Summary text (mobile) ── */
	.summary-text {
		font-size: 0.92rem;
		line-height: 1.7;
		opacity: 0.8;
	}

	/* ── Mobile narrative toggle ── */
	.narrative-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		cursor: pointer;
		padding: 0.6rem 0.85rem;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(74, 74, 58, 0.4);
		border-radius: 4px;
		font-family: var(--journal-font);
		color: var(--session-end-text);
		transition: background 0.15s;
	}
	.narrative-toggle:hover { background: rgba(255, 255, 255, 0.05); }
	.narrative-toggle-label { font-size: 0.85rem; opacity: 0.6; }
	.narrative-toggle-arrow {
		font-size: 0.75rem;
		opacity: 0.4;
		transition: transform 0.2s;
	}
	.narrative-toggle.open .narrative-toggle-arrow { transform: rotate(180deg); }

	.narrative-expand-body {
		padding: 1.25rem;
		border: 1px solid rgba(74, 74, 58, 0.3);
		border-top: none;
		border-radius: 0 0 4px 4px;
		background: rgba(0, 0, 0, 0.12);
		line-height: 1.8;
		font-size: 0.95rem;
		max-height: 400px;
		overflow-y: auto;
	}
	.narrative-expand-body p { margin-bottom: 1rem; opacity: 0.85; }
	.narrative-expand-body blockquote {
		border-left: 2px solid var(--journal-accent);
		padding-left: 1rem;
		margin: 0.75rem 0;
		color: var(--journal-accent);
		opacity: 0.9;
		font-style: italic;
	}

	/* ── Desktop: hide mobile-only elements ── */
	.mobile-identity,
	.mobile-summary,
	.mobile-narrative,
	.mobile-narrative-divider { display: none; }

	/* ── Mobile (<768px): single column, decision-first ── */
	@media (max-width: 768px) {
		.session-end-body {
			flex-direction: column;
			height: auto;
			overflow: visible;
		}
		.narrative-panel { display: none; }
		.action-sidebar {
			width: 100%;
			min-width: unset;
			padding: 1.75rem 1.25rem;
		}
		.mobile-identity,
		.mobile-summary,
		.mobile-narrative,
		.mobile-narrative-divider { display: block; }
		.mobile-identity { margin-bottom: 0.5rem; }
		.char-name { font-size: 1.5rem; }
	}

	/* ── Small phones ── */
	@media (max-width: 480px) {
		.session-end-header {
			flex-wrap: wrap;
			gap: 0.25rem;
			padding: 0.5rem 1rem;
		}
		.page-title {
			flex: none;
			width: 100%;
			order: -1;
			font-size: 0.85rem;
		}
		.keep-grid { gap: 0.4rem; }
		.keep-btn { padding: 0.75rem 0.5rem; }
	}
</style>
```

- [ ] **Step 7: Verify the app compiles**

Run: `npm run check`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add src/routes/session-end/+page.svelte
git commit -m "feat: redesign session-end page with split panel + decision-first mobile"
```

---

### Task 5: Manual browser testing

Run the dev server and test the redesigned page end-to-end.

- [ ] **Step 1: Start dev server**

Run: `eval "$(direnv export bash 2>/dev/null)" && npm run dev`

- [ ] **Step 2: Test desktop split-panel layout**

Open `http://localhost:5173` in a browser at full width. Play through a session to reach the session-end page. Verify:
- Left panel shows full narrative with prose paragraphs and blockquoted choices
- Right sidebar shows tags, "Keep this day" 2x2 grid, and "Toss this day" row
- The two panels scroll independently

- [ ] **Step 3: Test "Keep this day" actions**

Test each button:
- Forward in Time → saves, navigates to `/journal/setup` with future date
- Backward in Time → saves, navigates to `/journal/setup` with past date (disabled if no prior entries)
- Play Another Character → saves, shows suggestion cards replacing the grid
- Save & Menu → saves, goes to `/`

Verify the sync badge shows "Syncing..." then "Synced" on each save action.

- [ ] **Step 4: Test "Toss this day" actions**

- Undo & Redo → discards, navigates to `/journal/morning` with re-rolled hooks (compare hooks before and after — they should differ)
- Discard & Menu → discards, goes to `/`

- [ ] **Step 5: Test mobile layout**

Resize browser to < 768px width. Verify:
- Narrative panel is hidden
- Compact summary + tags shown at top
- 2x2 keep grid and toss row visible
- "Read the full journal entry" toggle at bottom expands/collapses narrative

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass, including the new `canGoToPast` tests.

- [ ] **Step 7: Commit any fixes**

If any issues were found and fixed during testing:

```bash
git add -u
git commit -m "fix: session-end page testing fixes"
```
