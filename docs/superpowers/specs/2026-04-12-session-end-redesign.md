# Session End Page Redesign

## Problem

The current session-end page has confusing "Save" / "Discard & Replay" / "Discard & Return to Menu" buttons. Players don't understand the distinction between saving and navigating. The summary is also too condensed — players want to re-read the full story of what happened.

## Design

### Layout

**Desktop (768px+): Split panel**
- Left panel: scrollable full narrative (journal entry as the player experienced it)
- Right panel: sticky sidebar with character identity, consequence tags, and all actions

**Mobile (<768px): Single column, decision-first**
- Compact summary + consequence tags at top
- 2x2 action grid ("Keep this day") front and center
- Discard row below
- Full narrative in collapsible accordion at the bottom (collapsed by default)

Breakpoint at 768px. No intermediate tablet layout — the split panel works down to 768px, then snaps to single column.

### Actions

Six actions in two groups. No standalone "Save" button — saving is a side effect of moving forward.

#### "Keep this day and..." (auto-save + GitHub commit)

All four call the existing `saveSession()` before navigating. The sync badge in the header shows progress.

| Action | Behavior | Destination |
|--------|----------|-------------|
| Forward in Time | Save, commit, generate future date | `/journal/setup` with future date + character pre-loaded |
| Backward in Time | Save, commit, generate past date | `/journal/setup` with past date + character pre-loaded |
| Play Another Character | Save, commit, show character suggestions | Suggestion cards replace the "Keep this day" group in-place (both layouts); selecting one goes to `/journal/setup` |
| Save & Menu | Save, commit | `/` (home) |

**Disabled states:**
- **Backward in Time** disabled when: character birth date equals current date, OR character has zero prior timeline entries
- **Forward in Time** disabled when: character is dead

#### "Toss this day" (no save, no commit)

| Action | Behavior | Destination |
|--------|----------|-------------|
| Undo & Redo | Reload last saved world state, clear session | `/journal/morning` with `forceReroll: true` (same character + date, fresh hooks) |
| Discard & Menu | Reload last saved world state, clear session | `/` (home) |

### Narrative Display

**Desktop left panel:**
- Character name + date header
- Full narrative rendered from `narrativeLog` store / `choiceLog` fallback
- Prose as paragraphs, player choices as styled blockquotes (matching `formatJournalEntry` output)
- Independent scroll from sidebar
- Death notice inline at end if character died

**Mobile collapsible:**
- "Read the full journal entry" toggle, collapsed by default
- Same content when expanded, with max-height and internal scroll
- Compact summary at top provides the gist without expanding

**Data source:** `ChoiceRecord.narrativeText` (prose) and `ChoiceRecord.text` (player choice) already captured during gameplay. `narrativeLog` store has the full ordered sequence. No new data collection needed.

### Hook Re-roll (Undo & Redo)

When "Undo & Redo" is pressed, the world state reverts to last save, so storyline tensions are identical to before the session. Without intervention, the morning page would generate the same hooks.

**Solution:** Add `forceReroll: boolean` to `NavigationContext`. When the morning page sees `forceReroll: true`, it applies random offsets to storyline tension scores before selecting hooks. This guarantees different hook options while preserving the existing hook selection logic.

## Files to Modify

- `src/routes/session-end/+page.svelte` — complete rewrite of template and styles; action handlers updated (remove standalone save, add save-and-navigate pattern, add save-and-menu)
- `src/lib/stores/navigation.ts` — add `forceReroll` to `NavigationContext` type
- `src/routes/journal/morning/+page.svelte` — read `forceReroll` flag, apply tension randomization when true
- `src/lib/engine/timeline.ts` — update backward-in-time disable check to include "no prior timeline entries"

## Out of Scope

- Improving the compact summary prose (current `sessionSummary` is functional)
- Changing the hook selection algorithm beyond the re-roll randomization
- Any changes to the gameplay page or morning page layout
- Tablet-specific breakpoints
