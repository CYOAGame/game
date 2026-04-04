# Phase 2: Timeline Navigation — Design Spec

**Date:** 2026-04-04
**Status:** Draft — pending review

## Vision

Enable players to navigate through time and across characters after completing a journal entry. The Past, The Future, and Someone Else become playable — transforming the game from a linear sequence of days into a living timeline where discoveries travel backward, relationships create narrative threads, and death closes doors but opens new ones through descendants.

## Scope

This phase adds timeline navigation on top of Phase 1's localStorage-based engine. No git/GitHub integration — that's Phase 3+. Everything here builds on the existing session loop.

## 1. Relationship Vectors

### Current State

`Character.relationships` is `Record<string, number>` — a flat number per character ID. The choice resolver already modifies it, but there's no way to distinguish trust from rivalry from family bonds.

### New Model

```ts
interface Relationship {
  tags: string[];                  // qualitative: "family:parent", "lover", "mentor", "trade_partner"
  axes: Record<string, number>;    // emotional vectors, each -10 to +10
}
```

`Character.relationships` changes from `Record<string, number>` to `Record<string, Relationship>`.

**Starting axes:**
- **trust** — do you rely on them?
- **affection** — do you like/love them?
- **rivalry** — do you compete with them?
- **respect** — do you admire them?
- **fear** — do they intimidate you?

Axes are arbitrary string keys — new axes can be added in event templates without code changes.

### Consequence Updates

Current consequence format:
```ts
{ type: 'relationship', target: '{bystander.id}', value: 3 }
```

New format adds an optional `axis` field:
```ts
{ type: 'relationship', target: '{bystander.id}', value: 3, axis: 'trust' }
```

When `axis` is omitted, defaults to `affection` for backward compatibility with existing events.

New consequence type for relationship tags:
```ts
{ type: 'relationship_tag', target: '{bystander.id}', value: 'friend' }
```

### Migration

Existing `Record<string, number>` relationships in saved world states are migrated on load: each numeric value becomes `{ tags: [], axes: { affection: <value> } }`.

## 2. World Snapshot Function

A single function that produces a date-appropriate `WorldState`:

```ts
function createWorldSnapshotAt(
  worldState: WorldState,
  targetDate: GameDate,
  questlines: Questline[]
): WorldState
```

**Characters:** Only those alive at `targetDate` — born before the date, not dead before the date.

**Locations:** ALL discovered locations are included regardless of when they were discovered. Soft consistency: a cave discovered in a future playthrough was always there. Once a location exists in the world state, it's available at every point in time. `LocationInstance` gains an optional `discoveredDate` field for tracking, but the snapshot function ignores it — once discovered, always available.

**Questline stage:** Reconstructed by walking the timeline entries backward from the target date. Finds the last timeline entry before `targetDate` that affected a questline counter, and determines what stage would have been active. If no timeline entries exist before the target date, defaults to stage 0.

**Factions:** Faction moods are approximated — walk timeline entries up to the target date and sum faction consequences. Falls back to initial moods from world config if no entries exist.

**World facts:** All accumulated world facts are included regardless of when they were created (same soft consistency as locations).

**Timeline:** Filtered to only entries at or before the target date.

## 3. Date Generation

### Random Past Date

`generatePastDate(character, worldState)`:
1. Define range: character's `birthDate` to the current most-recent session date
2. Collect timeline entries within that range
3. Pick a random date, weighted: dates within ±5 days of a timeline entry get 3x weight, dates near questline stage transitions get 5x weight
4. Return the weighted random date

### Random Future Date

`generateFutureDate(character, worldState)`:
1. If character is dead → return `null` (future is locked)
2. Define range: most-recent session date to +20 years (configurable via world config)
3. Same weighting as past — timeline entries and questline transitions get bonus weight
4. Return the weighted random date

### Date Utilities

- `compareDates(a, b, seasonOrder)` — updated to properly compare seasons using the world config's season array ordering
- `randomDateInRange(start, end, weights?)` — core random date picker with optional weight function
- `daysFromDate(date, seasonOrder)` — convert a GameDate to a linear day count for math

## 4. "Someone Else" Suggestions

`suggestCharacters(currentCharacterId, worldState, playedCharacterIds)`:

Returns exactly 3 options:

1. **Relationship extreme** — find the character with the most extreme axis value in a relationship to any character the player has played. Highest absolute value on any axis wins. "Your blacksmith's fiercest rival" or "the merchant who trusts you most."

2. **Family or situational** — first, look for family connections (`family:child`, `family:sibling`, `family:parent` tags) to any played character. If none exist, pick a character in an interesting location given the current questline stage (e.g., someone at the border when the border is falling). If a played character is dead, prioritize their descendants.

3. **Someone New** — a "create new character" option. Player proceeds to the setup page with archetype selection. The new character is placed at a location relevant to the current questline stage.

Each suggestion shows: character name, archetype, a brief context line ("Your rival from the market," "Elena's daughter," "A stranger in troubled times").

## 5. Dead Character Handling

When a character is dead:
- **"The Future" button** is disabled with text: "This character's story has ended"
- **Descendants are surfaced** in "Someone Else" suggestions — characters with a `family:child` tag pointing to the dead character
- **"The Past" button** remains fully functional — bounded by birth and death dates
- If no descendants exist and the player picks "Someone Else," the engine may create one via waveform collapse, linking them with `family:child` if the archetype matches

### Lineage Creation

When the collapse engine creates a new character and a dead character of the same archetype exists:
- 30% chance the new character is linked as `family:child` of the dead character
- Inherits some trait tendencies (±2 from parent's values)
- Gets a birth date that makes sense (15-40 years after the parent's birth date)

## 6. Session-End Page Updates

The three "Next Entry" buttons become functional:

**"The Past" button:**
- Enabled if the character has been alive for more than 1 day (birth < current date)
- On click: generates a past date, creates world snapshot, navigates to setup page with pre-selected character and snapshot

**"The Future" button:**
- Enabled if the character is alive
- Disabled with message if dead: "This character's story has ended"
- On click: generates a future date, creates world snapshot, navigates to setup page

**"Someone Else" button:**
- Always enabled
- On click: shows the 3 suggestions inline (replaces the button with a selection UI)
- Each suggestion is a card with character name, archetype, context line
- Clicking a suggestion navigates to setup page with that character pre-selected
- "Someone New" navigates to setup page with archetype selection

## 7. Setup Page Integration

The `/journal/setup` page currently always creates a new character from an archetype. It needs a second mode:

**New character mode (existing):** archetype selection → day-type preferences → begin

**Pre-selected character mode (new):**
- Receives character ID, target date, and time context via URL params or store
- Skips archetype selection — shows the character's name, archetype, traits, and the target date
- Shows day-type preferences
- "Begin the Day" creates a session with the pre-selected character and date-appropriate world snapshot

## 8. Session Type Update

`PlaySession` gets a new field:

```ts
timeContext: 'past' | 'present' | 'future'
```

Default: `'present'`. Set based on how the session was started.

Event templates can use this for flavor — the text generator checks `timeContext` and adjusts descriptions. For now, this is informational. Future work could add time-context-specific event templates.

## Type Changes Summary

**`Character`** (state.ts):
- `relationships`: `Record<string, number>` → `Record<string, Relationship>`
- Add `parentId?: string` (convenience field, backed by `family:child` tag in relationships)

**New type `Relationship`** (state.ts):
- `tags: string[]`
- `axes: Record<string, number>`

**`Consequence`** (blocks.ts):
- Add optional `axis?: string` field

**New consequence type** (blocks.ts):
- `'relationship_tag'` added to Consequence type union

**`LocationInstance`** (state.ts):
- Add optional `discoveredDate?: GameDate`

**`PlaySession`** (session.ts):
- Add `timeContext: 'past' | 'present' | 'future'`
- Add `playedCharacterIds: string[]` (tracks all characters played in this world for suggestion quality)

**`WorldState`** (state.ts):
- Add `playedCharacterIds: string[]` (persisted across sessions)

## New Files

- `src/lib/engine/timeline.ts` — `createWorldSnapshotAt`, `generatePastDate`, `generateFutureDate`, `suggestCharacters`, date utilities
- `tests/engine/timeline.test.ts` — tests for all of the above

## Modified Files

- `src/lib/types/state.ts` — Relationship type, Character updates, LocationInstance update, WorldState update
- `src/lib/types/blocks.ts` — Consequence axis field, relationship_tag type
- `src/lib/types/session.ts` — PlaySession timeContext and playedCharacterIds
- `src/lib/engine/choice-resolver.ts` — handle axis-based relationship consequences and relationship_tag consequences
- `src/lib/engine/collapse.ts` — lineage creation for new characters near dead ancestors
- `src/lib/engine/world-loader.ts` — migration logic for old relationship format on load
- `src/routes/session-end/+page.svelte` — enable timeline navigation buttons with full flows
- `src/routes/journal/setup/+page.svelte` — pre-selected character mode
- `src/routes/+page.svelte` — update demo world events with axis-based relationship consequences
- `tests/fixtures/world-state.ts` — update relationship format in fixtures
- `tests/engine/choice-resolver.test.ts` — update tests for new relationship format

## Open Questions

None — all major design decisions resolved during brainstorming.
