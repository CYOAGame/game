# Journal RPG — Design Spec

**Date:** 2026-04-04
**Status:** Draft — pending review

## Vision

A procedural web-based RPG where players live out single days in the lives of background characters, recorded as journal entries. The world runs a macro questline (e.g., a demon invasion) that creates pressure and context, while players make consequential micro-decisions that ripple outward. The world's timeline is stored as a git repository — branching, history, and collaboration use actual git mechanics.

## Core Concepts

### The Journal Entry (Play Session)

A play session = one day in a character's life, written as a journal entry. The player:

1. Selects a character and time period (or accepts a suggestion)
2. Optionally sets day-type preferences (action, romance, crafting, exploration, etc.)
3. Plays through procedurally generated events, making choices at each decision point
4. Ends the session by choosing to **rest** (voluntary), or the session ends via **exhaustion** or **death**
5. Decides whether to **save** (merge), **discard and replay**, or **discard and move on**
6. Navigates to the next entry: **the past**, **the future**, or **someone else**

### Timeline Navigation

After completing a journal entry, the player chooses their next entry:

- **The Past** — a random earlier point in the current character's life (bounded by birth)
- **The Future** — a random later point in the current character's life (bounded by death, if it has occurred)
- **Someone Else** — a different character at a different time. The engine suggests 2-3 options based on organic connections (characters affected by recent events, characters in interesting locations) plus a random/new option.

### World Consistency Model

**Soft consistency.** The world accumulates established facts — places, characters, landmarks, events — that persist across all time periods once discovered. A tavern found in a future entry exists in the past too. But individual journal entries don't need to perfectly agree on subjective details. Memory is unreliable, perspectives differ. The world reconciles what it can, and contradictions are acceptable.

When a player plays the past and makes choices, those choices retroactively enrich the world's shared facts. Future entries may reference things established in past-play sessions. The world tries to stay consistent but doesn't break if it can't.

### The Main Questline

The macro narrative that gives the world pressure and context. Questlines are authored by admins as modular blocks.

A questline consists of **stages** (e.g., "The Demon Gathers Forces" → "Heroes Rally" → "The Border Falls" → "Final Siege"). Each stage defines:

- **World conditions** — what events become available, faction moods, danger levels
- **Advancement triggers** — cumulative player/world actions that push to the next stage
- **Regression triggers** — conditions that push the quest backward
- **Flavor shifts** — how daily life changes (a tavern in peacetime vs. during a siege)

Multiple questlines can run in parallel. The questline makes the world feel alive even during mundane play — you're a farmer tending crops, but refugees are streaming through your village because the border fell.

### Waveform Collapse

Event templates reference generic roles ("the antagonist," "a local authority figure," "a traveling stranger") rather than specific characters. When an event fires, the engine:

1. Searches existing living characters for someone who fits the role
2. If a match exists → use them (organic recurring characters)
3. If no match → instantiate a new character from a matching archetype
4. Once collapsed, that character is permanent — a new world fact

This is how connections between play sessions emerge naturally. The blacksmith you played might show up as a side character when you're playing the merchant.

## Architecture

### Git-Backed with Local Engine (Option B)

Game logic runs entirely client-side in the browser. World state lives in memory during play. Git is the persistence and collaboration layer.

- **During play:** all game logic is local, no API calls per choice
- **On save:** batch commit/PR to the git repo via GitHub API
- **On load:** pull current world state from `main` branch

This keeps the git-as-timeline metaphor while avoiding API rate limits and latency during gameplay.

### Git Mapping

| Game Concept | Git Mechanic |
|---|---|
| A journal entry in progress | A branch (`journal/character/date`) |
| Each player choice | A commit on the branch |
| Saving an entry | Merging a PR into `main` |
| Discarding an entry | Closing the PR without merge |
| Replaying an entry | Close PR, new branch from same base |
| World history | Git log on `main` |
| Sharing a world | Forking the repo |
| Multiplayer | Multiple contributors to one repo |
| Character death | A commit that closes future options |

### Player Authentication

Two options, player chooses:

- **GitHub OAuth** — "Login with GitHub" button, standard OAuth flow. Requires a small serverless function (Cloudflare Worker, ~20 lines) for the token exchange callback. Best UX.
- **Personal Access Token (PAT)** — player generates a token in GitHub settings and pastes it into the game. No server-side component needed. Good for privacy-conscious players or private instances.

Both store the token in browser localStorage. Tokens never leave the client except to call the GitHub API.

### Play Session Flow (Git Operations)

1. **Session start** → pull `state/` from `main`. Game state lives in browser memory during play.
2. **Each choice** → tracked in memory. No API calls during active play (fast, offline-capable).
3. **Rest/death/exhaustion** → engine creates a branch (`journal/{character}/{date}`), writes one commit per choice (retroactively from the in-memory log), and opens a PR to `main`. This preserves the full decision chain in git history while keeping gameplay snappy.
4. **Save** → merge PR. **Discard** → close PR. **Replay** → close PR, new branch from same base.
5. **Resume interrupted session** → if the browser closes mid-play (before PR creation), the in-memory state is lost. IndexedDB can optionally cache session state for recovery.

### Multiplayer Conflict Resolution

Multiple players can play in the same world asynchronously. Conflicts are rare because:

- Character-specific files (`state/characters/elena.yaml`) are only modified by the player controlling that character
- Journal files are unique per character and date
- Shared state (`questline-state.yaml`, `factions.yaml`) uses additive changes where possible

When merge conflicts occur on shared state, the engine auto-resolves with simple rules (e.g., sum faction changes, take the higher questline stage).

## World Data Model

### Block Types (Authored Content)

Five modular, shareable block types that admins author:

**1. Archetypes** (`blocks/archetypes/*.yaml`)
- Character templates: "blacksmith," "traveling merchant," "deserter"
- Trait ranges, possible skills, naming conventions
- Optional faction/location ties

**2. Event Templates** (`blocks/events/*.yaml`)
- Things that can happen: "bandit raid," "harvest festival," "plague outbreak"
- Preconditions (season, questline stage, location type, faction state)
- Choice trees with branching narrative
- Choices reference generic **roles**, not specific characters
- Each choice defines consequences: stat changes, faction shifts, world facts, exhaustion cost

**3. Location Types** (`blocks/locations/*.yaml`)
- Places: "tavern," "crossroads shrine," "mine entrance"
- What events can occur there, what archetypes frequent them
- Flavor text and atmosphere descriptors

**4. Questlines** (`blocks/questlines/*.yaml`)
- Macro narrative arcs with stages
- World conditions, advancement/regression triggers, flavor shifts per stage
- Multiple can run in parallel

**5. World Config** (`world.yaml`)
- Setting name, description, era/date system
- Theme reference (background image, fonts, colors)
- Starting factions, geography seeds
- Which questlines are active

### World Repo Structure

```
my-world-repo/
├── world.yaml                      # World config
├── theme/
│   ├── background.jpg              # Admin's texture/theme image
│   ├── style.css                   # Font/color overrides
│   └── portraits/                  # Optional character art
├── blocks/
│   ├── archetypes/
│   │   ├── blacksmith.yaml
│   │   └── ...
│   ├── events/
│   │   ├── bandit-raid.yaml
│   │   └── ...
│   ├── locations/
│   │   ├── tavern.yaml
│   │   └── ...
│   └── questlines/
│       ├── demon-invasion.yaml
│       └── ...
├── state/
│   ├── timeline.yaml               # Master timeline of committed events
│   ├── questline-state.yaml        # Current stage of each questline
│   ├── factions.yaml               # Faction standings
│   └── characters/
│       ├── elena-blacksmith.yaml   # Collapsed (living) characters
│       └── ...
├── journals/
│   ├── elena-blacksmith/
│   │   ├── 0847-spring-14.md       # Journal entries
│   │   └── ...
│   └── ...
└── players/
    └── github-handle.yaml          # Player prefs, LLM config reference
```

**blocks/** = authored templates (static). **state/** = living world (changes every commit). **journals/** = narrative output (the story).

## Procedural Engine (Client-Side)

### Engine Loop

1. **Load world state** — pull `state/` from `main`. Know who's alive, questline stages, faction moods, locations.
2. **Determine day context** — character, time period, questline stage, location, player's day-type preferences.
3. **Select and collapse events** — filter event templates by preconditions, weight by player preferences, pick one. Fill roles via waveform collapse (search existing characters → instantiate from archetypes if needed).
4. **Present choices** — render the event template's choice tree as journal narrative. 2-4 choices per node, each with preconditions, consequences, and exhaustion cost. "Rest" is always available.
5. **Track cascading effects** — each choice updates: character stats, faction reputation, questline trigger counters, new world facts, character relationships.

### Text Generation

**Without LLM (default):** Template strings with variable substitution.
```
"You arrive at {location.name}. {character.name} the {character.archetype}
looks up from {character.activity}. {questline_flavor}"
```
Multiple template variants per event for variety.

**With LLM (optional):** Player configures in their settings:
- `llm: none` — template text only (default)
- `llm: local` — local endpoint (Ollama, LM Studio, etc.)
- `llm: claude` — Claude API (player provides their own key)

The engine sends scene context (character, location, event, questline stage, previous choices) to the LLM. Game logic stays identical — LLM only affects prose quality. API keys stored in browser localStorage, never committed to the repo.

## Frontend

### Tech Stack

- **SvelteKit** (static adapter) — compiles to static HTML/JS for GitHub Pages
- **isomorphic-git** — git operations in the browser (clone, branch, commit, merge) via IndexedDB
- **Octokit** — GitHub API client for PRs, OAuth, push/pull
- **js-yaml** — YAML parsing for block files and world state
- **marked** — markdown rendering for journal entries

### Game Codebase Structure

```
ChooseYourOwnAdventure/
├── src/
│   ├── lib/
│   │   ├── engine/
│   │   │   ├── world-loader.ts      # Pulls state from git
│   │   │   ├── collapse.ts          # Waveform collapse — role filling
│   │   │   ├── event-selector.ts    # Picks events based on context
│   │   │   ├── choice-resolver.ts   # Processes choices → consequences
│   │   │   ├── text-generator.ts    # Template text + LLM adapter
│   │   │   └── questline-tracker.ts # Advances/regresses questline stages
│   │   ├── git/
│   │   │   ├── client.ts            # isomorphic-git + Octokit wrapper
│   │   │   ├── branch.ts            # Branch/PR lifecycle
│   │   │   └── merge.ts             # Conflict resolution logic
│   │   ├── stores/
│   │   │   ├── session.ts           # Current play session state
│   │   │   ├── world.ts             # Loaded world state
│   │   │   └── player.ts            # Player prefs, auth token
│   │   └── types/
│   │       ├── blocks.ts            # Archetype, Event, Location, Questline types
│   │       ├── state.ts             # Character, Timeline, Faction types
│   │       └── session.ts           # Active session types
│   ├── routes/
│   │   ├── +page.svelte             # Landing / login
│   │   ├── journal/+page.svelte     # Main play view
│   │   ├── session-end/+page.svelte # Rest/save/navigate screen
│   │   └── timeline/+page.svelte    # Browse world history
│   └── app.html
├── static/
│   └── themes/
│       └── default/                  # Default parchment theme
├── docs/
│   └── superpowers/specs/
├── svelte.config.js
├── package.json
└── CLAUDE.md
```

### Journal Interface

**During play:** Parchment/themed aesthetic. Story text scrolls naturally. Choices appear inline within the narrative. Exhaustion meter is subtle. "Rest" is always an available choice. The admin's theme (background texture, fonts, colors) reskins the entire view via CSS custom properties.

**Session end:** Visual shift to a darker overlay. Shows entry summary and consequences. Save/discard decision followed by timeline navigation (past/future/someone else). Two separate decision steps.

### Theming

Admins include theme assets in the world repo (`theme/` directory). The game loads:
- `background.jpg` — page texture
- `style.css` — CSS custom property overrides (fonts, colors, accent colors)
- Optional `portraits/` for character art

Default theme: medieval parchment with serif fonts.

## Modular Block Ecosystem

Blocks are designed for sharing. Players and admins can:
- Export blocks as individual YAML files
- Share block packs (a zip/repo of related archetypes + events + locations)
- Import blocks by dropping files into the appropriate `blocks/` subdirectory
- A world repo's `blocks/` directory is the complete content library — fork a world and add/remove blocks to customize

Since everything is in git, sharing blocks is as simple as copying files between repos or maintaining a shared blocks repository that world admins pull from.

## Open Questions

None — all major design decisions resolved during brainstorming.
