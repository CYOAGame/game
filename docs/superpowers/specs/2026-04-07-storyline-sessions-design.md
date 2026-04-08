# Storyline-Based Session System - Design Spec

**Date:** 2026-04-07
**Status:** Draft - pending review

## Vision

Replace the current random event-chaining system with a storyline-based session model. Each session is one deep event chosen from a morning menu of hooks. Storylines persist across sessions, escalate when ignored, and create a living world that moves whether the player is watching or not.

## Core Changes

### What's Being Replaced

**Current system:** Session starts, engine picks a random event, player makes 2-5 choices, event ends, another random event chains in via "time passes..." transition. Sessions feel like a series of disconnected mini-scenes.

**New system:** Session starts with a morning menu of 2-6 hooks based on world state. Player picks one. That single event IS the entire session with 20-50+ nodes of deep branching. No event chaining. Storylines continue across sessions with time-skip recaps. Unattended storylines escalate on their own through NPC action.

## 1. The Morning Menu

### Hook Generation

At session start, the engine builds a menu of available hooks:

1. Load world state and storyline states
2. Run tension escalation for all active storylines (see section 3)
3. Filter all events by preconditions (archetype, skills, world facts, questline stage)
4. Group eligible events by `storyline` field
5. For each storyline group, pick the most advanced eligible chapter
6. Standalone events (no `storyline` field) each become their own hook
7. Score hooks by relevance: archetype match, tension level, player history
8. Present 2-6 hooks to the player, sorted by urgency

### Hook Display

Each hook shows:
- **Teaser line** - first 1-2 sentences of the event's entry node text, interpolated with role names
- **Storyline name** - if part of a storyline, show the arc name
- **Tension indicator** - visual urgency: calm (0-25), stirring (26-50), urgent (51-80), critical (81+)
- **Chapter info** - "Chapter 2 of 4" if applicable

### No Guaranteed Quiet Option

The number of hooks varies based on world state. A world in crisis shows many urgent hooks. A peaceful world shows 2-3 calm options. No artificial "quiet day" escape valve.

## 2. Storyline Structure

### Event Template Changes

Events gain optional fields:

```yaml
storyline: market_conspiracy     # plot thread this belongs to (optional)
chapter: 2                       # ordering within storyline (optional)
reentry_recap: "Three days since you found the ledgers. The clerk sent word this morning."
escalation:
  chance_base: 0.1               # base tension increase per skipped session (0-1 scale, maps to 0-10 points)
  advances_to: chapter-3         # which chapter this escalates to
  world_facts_set:               # facts set when NPC drives it forward
    guild_standoff: true
```

Events WITHOUT a `storyline` field are standalone one-offs. They work exactly as they do today but appear as individual hooks in the morning menu.

### Folder Convention

Storyline chapters live in subfolders:

```
blocks/events/
  market-conspiracy/
    chapter-1-discovery.yaml
    chapter-2-investigation.yaml
    chapter-3-confrontation.yaml
    chapter-4-aftermath.yaml
  sealed-depths/
    chapter-1-entrance.yaml
    chapter-2-depths.yaml
    chapter-3-heart.yaml
  guild-tensions.yaml            # standalone
  quiet-morning.yaml             # standalone
```

The YAML loader already reads recursively, so subfolders load automatically.

### Chapter Chaining via World Facts

- Chapter 1 sets world facts in its consequences (`price_fixing_discovered: true`)
- Chapter 2 has a precondition on that fact
- When chapter 1 is saved, the world facts unlock chapter 2
- Next session, chapter 2 appears as a hook in the morning menu

### Re-entry Recaps

When a storyline chapter fires and the player has played earlier chapters, the `reentry_recap` text displays before the first node. This bridges the time gap between sessions.

The recap text can be a template with variable references (`{character.name}`, etc.) just like node text.

## 3. Hook Escalation (Tension System)

### Tension Tracking

Each storyline tracks a numeric **tension** value (0-100) in the world state:

```yaml
# state/storylines.yaml
market_conspiracy:
  currentChapter: 1
  tension: 35
  lastPlayerSession: "entry_1234"
  lastEscalationDate: { year: 845, season: spring, day: 3 }
  npcDriverId: null

sealed_depths:
  currentChapter: 1
  tension: 10
  lastPlayerSession: null
  lastEscalationDate: null
  npcDriverId: null
```

### Tension Changes Per Session

At the start of each session, before building the morning menu:

**For each active storyline:**
- **Base drift:** +5 to +15 random points per skipped session
- **Activity modifier:** if the player has set world facts related to this storyline in recent sessions, tension rises 1.5x faster (the world is reacting to their actions)
- **Neglect modifier:** if the player has NEVER engaged with this storyline (lastPlayerSession is null), tension rises at 0.5x rate (nobody stirred this pot)
- **Cap:** tension cannot exceed 100

### Threshold Escalation

When tension crosses a threshold:
- **50:** chapter advances. An NPC is picked via waveform collapse to drive it forward. Their action is recorded as a timeline entry. World facts from the escalation config are set. Tension resets to 0 for the new chapter.
- **80:** (if still at the same chapter because the 50-threshold escalation was for a different storyline) major escalation with heavier consequences in the world facts.

### Player Engagement Resets Tension

When the player plays a storyline chapter:
- Tension for that storyline resets to 0
- The player's actions set world facts, unlocking the next chapter naturally
- The storyline advances because the player drove it, not an NPC

### Escalation Cap

- A storyline can only auto-escalate one chapter per session
- Only one storyline can auto-escalate per session. If multiple cross 50 simultaneously, the one with the highest tension wins.
- This prevents the world from racing ahead while the player does one thing

### Past Rewriting

When a player goes to the past and plays a chapter that was previously NPC-escalated:
- Their choices set new world facts, potentially different from the NPC's
- The NPC's timeline entry is superseded (not deleted, just marked as superseded)
- Downstream effects use the player's facts instead of the NPC's
- Soft consistency handles any contradictions

## 4. Session Flow (Complete)

### 1. The Morning

```
Engine loads world state
  -> Run tension escalation for all storylines
  -> Build hook menu from eligible events
  -> Navigate to /journal/morning
  -> Player sees 2-6 hooks with teasers and tension indicators
```

### 2. The Player Chooses

```
Player picks a hook
  -> If continuing a storyline: show reentry_recap
  -> Load the event, begin play at entry node
  -> Navigate to /journal
```

### 3. The Day

```
One event, deep branching, 20-50 nodes
  -> No event chaining
  -> When nodes reach terminal (nextNodeId: null):
     -> If player has exhaustion remaining AND event has unexplored hub nodes:
        -> Offer "There's still daylight. Continue?" (loops back to hub)
     -> Otherwise: "The day draws to a close."
  -> Rest triggered by: player choice, exhaustion cap, death, or all nodes explored
```

### 4. The Evening

```
Player rests
  -> Timeline entry created with full narrative
  -> Journal markdown saved
  -> Tension for played storyline resets to 0
  -> Tension for all OTHER storylines gets a small bump (+2-5)
  -> World facts from this session persist
  -> Navigate to /session-end
```

### 5. Next Session

```
Morning menu reflects changed world
  -> Played storyline may show next chapter
  -> Ignored storylines may have escalated (discovered through play)
  -> New standalone events may be available
```

## 5. New Types

### StorylineState (state/storylines.yaml)

```ts
interface StorylineState {
  currentChapter: number;
  tension: number;
  lastPlayerSession: string | null;   // timeline entry ID
  lastEscalationDate: GameDate | null;
  npcDriverId: string | null;         // character who drove escalation
}
```

### Hook (generated at runtime, not persisted)

```ts
interface Hook {
  eventId: string;
  storyline: string | null;
  chapter: number | null;
  teaserText: string;
  tension: number;                    // 0-100
  urgency: 'calm' | 'stirring' | 'urgent' | 'critical';
  isStorylineContinuation: boolean;
  reentryRecap: string | null;
}
```

### EventTemplate additions

```ts
// Added to existing EventTemplate interface
storyline?: string;
chapter?: number;
reentry_recap?: string;
escalation?: {
  chance_base: number;
  advances_to: string;
  world_facts_set: Record<string, string | number | boolean>;
};
```

### WorldState addition

```ts
// Added to existing WorldState
storylineStates: Record<string, StorylineState>;
```

## 6. New Files

- `src/lib/engine/storyline-manager.ts` - tension tracking, escalation logic, hook generation, storyline state management
- `src/lib/types/storyline.ts` - StorylineState, Hook types
- `src/routes/journal/morning/+page.svelte` - the morning menu page

## 7. Modified Files

- `src/lib/types/blocks.ts` - add storyline/chapter/reentry_recap/escalation to EventTemplate
- `src/lib/types/state.ts` - add storylineStates to WorldState
- `src/routes/journal/+page.svelte` - remove event chaining, single event per session, wind-down logic
- `src/routes/journal/setup/+page.svelte` - navigate to /journal/morning instead of /journal
- `src/lib/engine/world-loader.ts` - handle storylineStates in save/load/migration
- `src/lib/git/repo-writer.ts` - serialize storylineStates to state/storylines.yaml
- `src/lib/git/yaml-loader.ts` - load storylineStates, handle event subfolders

## 8. Content Changes (Ironhaven Repo)

- Restructure existing storyline events (traveler, market conspiracy, sealed depths, trial, guild tensions, mystery arc) into chapter subfolders
- Add storyline/chapter/reentry_recap/escalation fields to all chapter events
- Ensure each chapter is 20-50 nodes deep (expand existing mega-events, deepen shorter ones)
- Standalone events (quiet morning, lost child, tavern brawl, etc.) stay as-is in the root events folder

## 9. What Gets Removed

- Event chaining in journal page (`startNextEvent` function, transition beats)
- "Time passes..." separators between events
- `recentEventIds` staleness tracking (replaced by tension system)
- The random event selection loop (replaced by morning menu hook selection)

## Open Questions

None - all design decisions resolved during brainstorming.
