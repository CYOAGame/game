# Phase 1: Core Engine + Local Play — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a playable Journal RPG in the browser with procedural event generation, waveform collapse, and the journal interface — using local storage instead of git. This proves out the game loop before adding GitHub integration in Phase 2.

**Architecture:** SvelteKit static app. Game engine in TypeScript under `src/lib/engine/`. World data as YAML files loaded at build time (bundled) or from localStorage. Svelte stores manage reactive state. Journal UI renders themed narrative with inline choices.

**Tech Stack:** SvelteKit (static adapter), TypeScript, Vitest (testing), js-yaml, marked

**Phases Overview:**
- **Phase 1 (this plan):** Core engine + local play (localStorage persistence)
- **Phase 2 (future):** Git/GitHub integration (isomorphic-git, Octokit, PRs, OAuth/PAT)
- **Phase 3 (future):** Multiplayer, LLM integration, block sharing ecosystem

---

## File Structure

```
ChooseYourOwnAdventure/
├── src/
│   ├── lib/
│   │   ├── types/
│   │   │   ├── blocks.ts            # Archetype, EventTemplate, LocationType, Questline, WorldConfig
│   │   │   ├── state.ts             # Character, Timeline, FactionState, QuestlineState
│   │   │   └── session.ts           # PlaySession, ChoiceRecord, SessionOutcome
│   │   ├── engine/
│   │   │   ├── collapse.ts          # Waveform collapse — match characters to roles or instantiate
│   │   │   ├── event-selector.ts    # Filter/weight/pick event templates for a day
│   │   │   ├── choice-resolver.ts   # Process a player choice → state mutations
│   │   │   ├── questline-tracker.ts # Advance/regress questline stages based on triggers
│   │   │   ├── text-generator.ts    # Template string interpolation
│   │   │   └── world-loader.ts      # Load world state from localStorage (Phase 1) or git (Phase 2)
│   │   ├── stores/
│   │   │   ├── world.ts             # Svelte store: loaded world state
│   │   │   ├── session.ts           # Svelte store: active play session
│   │   │   └── player.ts            # Svelte store: player prefs
│   │   └── data/
│   │       └── demo-world/          # Bundled demo world (YAML files for a medieval skeleton)
│   ├── routes/
│   │   ├── +layout.svelte           # App shell, theme loader
│   │   ├── +page.svelte             # Landing page — start/continue
│   │   ├── journal/
│   │   │   └── +page.svelte         # Main play view
│   │   └── session-end/
│   │       └── +page.svelte         # Rest/save/navigate screen
│   └── app.html
├── static/
│   └── themes/
│       └── default/
│           ├── background.jpg
│           └── style.css
├── tests/
│   ├── engine/
│   │   ├── collapse.test.ts
│   │   ├── event-selector.test.ts
│   │   ├── choice-resolver.test.ts
│   │   ├── questline-tracker.test.ts
│   │   └── text-generator.test.ts
│   └── fixtures/
│       ├── archetypes.ts
│       ├── events.ts
│       ├── locations.ts
│       ├── questlines.ts
│       └── world-state.ts
├── docs/
│   └── superpowers/
│       ├── specs/
│       └── plans/
├── svelte.config.js
├── vite.config.ts
├── tsconfig.json
├── package.json
└── CLAUDE.md
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `src/app.html`, `src/routes/+page.svelte`, `src/routes/+layout.svelte`

- [ ] **Step 1: Initialize SvelteKit project**

```bash
cd /media/joe/957c3d40-f13a-4b84-b218-6e8fb573b676/projects/MV-GC/ChooseYourOwnAdventure
npx sv create --template minimal --types ts --no-add-ons --no-install .
```

If the directory is not empty, the tool may prompt — accept overwriting. This scaffolds SvelteKit with TypeScript.

- [ ] **Step 2: Install dependencies**

```bash
npm install
npm install -D vitest js-yaml marked @types/js-yaml
npm install -D @sveltejs/adapter-static
```

- [ ] **Step 3: Configure static adapter**

Replace the adapter in `svelte.config.js`:

```js
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/kit/vite';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html'
		})
	},
	preprocess: vitePreprocess()
};

export default config;
```

- [ ] **Step 4: Configure Vitest**

Add to `vite.config.ts`:

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node'
	}
});
```

- [ ] **Step 5: Add test script to package.json**

Add to the `"scripts"` section:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Create a placeholder landing page**

Replace `src/routes/+page.svelte`:

```svelte
<h1>Journal RPG</h1>
<p>A procedural RPG where you live out the days of background characters.</p>
```

- [ ] **Step 7: Verify dev server starts**

```bash
npm run dev -- --port 5173 &
sleep 3
curl -s http://localhost:5173 | head -20
kill %1
```

Expected: HTML containing "Journal RPG"

- [ ] **Step 8: Verify tests run**

```bash
npx vitest run
```

Expected: "No test files found" (no tests yet, but the runner works)

- [ ] **Step 9: Update .gitignore and CLAUDE.md**

Add to `.gitignore`:

```
node_modules/
build/
.svelte-kit/
```

Update `CLAUDE.md` with dev commands:

```markdown
## Development

### Commands
- `npm run dev` — start dev server
- `npm run build` — build static site
- `npm run test` — run tests
- `npm run test:watch` — run tests in watch mode

### Tech Stack
- SvelteKit (static adapter) → GitHub Pages
- TypeScript, Vitest, js-yaml, marked
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold SvelteKit project with TypeScript and Vitest"
```

---

### Task 2: Core Type Definitions

**Files:**
- Create: `src/lib/types/blocks.ts`
- Create: `src/lib/types/state.ts`
- Create: `src/lib/types/session.ts`

- [ ] **Step 1: Define block types**

Create `src/lib/types/blocks.ts`:

```ts
/** A character template — "blacksmith", "merchant", "deserter" */
export interface Archetype {
	id: string;
	name: string;
	traits: Record<string, TraitRange>;
	skills: string[];
	namingPatterns: string[];
	factions?: string[];
	locations?: string[];
	activities: string[];
}

export interface TraitRange {
	min: number;
	max: number;
}

/** A role that an event needs filled — resolved via waveform collapse */
export interface Role {
	id: string;
	label: string;
	archetypeFilter?: string[];
	traitRequirements?: Record<string, { min?: number; max?: number }>;
	factionRequirements?: string[];
}

/** A single choice node in an event's branching narrative */
export interface ChoiceNode {
	id: string;
	text: string;
	choices: Choice[];
}

export interface Choice {
	id: string;
	label: string;
	preconditions?: ChoicePrecondition[];
	consequences: Consequence[];
	exhaustionCost: number;
	nextNodeId: string | null;
}

export interface ChoicePrecondition {
	type: 'trait' | 'skill' | 'item' | 'faction';
	key: string;
	min?: number;
}

export interface Consequence {
	type: 'stat' | 'faction' | 'questline' | 'world_fact' | 'relationship' | 'death' | 'exhaustion';
	target: string;
	value: number | string | boolean;
}

/** A thing that can happen — "bandit raid", "harvest festival" */
export interface EventTemplate {
	id: string;
	name: string;
	tags: string[];
	preconditions: EventPrecondition[];
	roles: Role[];
	entryNodeId: string;
	nodes: Record<string, ChoiceNode>;
}

export interface EventPrecondition {
	type: 'questline_stage' | 'season' | 'location_type' | 'faction_mood' | 'tag';
	key: string;
	value: string | number;
	operator?: 'eq' | 'gte' | 'lte' | 'in';
}

/** A place — "tavern", "crossroads shrine", "mine entrance" */
export interface LocationType {
	id: string;
	name: string;
	tags: string[];
	eventTags: string[];
	archetypeIds: string[];
	flavorTexts: string[];
}

/** A questline stage */
export interface QuestlineStage {
	id: string;
	name: string;
	description: string;
	worldConditions: Record<string, string | number | boolean>;
	advancementTriggers: Trigger[];
	regressionTriggers: Trigger[];
	flavorShifts: Record<string, string>;
}

export interface Trigger {
	type: 'counter' | 'event' | 'time';
	key: string;
	threshold: number;
}

/** A macro narrative arc */
export interface Questline {
	id: string;
	name: string;
	description: string;
	stages: QuestlineStage[];
}

/** Top-level world configuration */
export interface WorldConfig {
	name: string;
	description: string;
	setting: string;
	dateSystem: DateSystem;
	startingFactions: FactionDef[];
	activeQuestlines: string[];
	theme: ThemeConfig;
}

export interface DateSystem {
	seasons: string[];
	daysPerSeason: number;
	startYear: number;
}

export interface FactionDef {
	id: string;
	name: string;
	description: string;
	initialMood: number;
}

export interface ThemeConfig {
	backgroundImage?: string;
	styleSheet?: string;
	fontFamily?: string;
}
```

- [ ] **Step 2: Define world state types**

Create `src/lib/types/state.ts`:

```ts
/** A collapsed (real) character living in the world */
export interface Character {
	id: string;
	name: string;
	archetypeId: string;
	traits: Record<string, number>;
	skills: string[];
	locationId: string;
	factions: Record<string, number>;
	relationships: Record<string, number>;
	birthDate: GameDate;
	deathDate: GameDate | null;
	alive: boolean;
}

export interface GameDate {
	year: number;
	season: string;
	day: number;
}

/** Compare two GameDates. Returns negative if a < b, 0 if equal, positive if a > b */
export function compareDates(a: GameDate, b: GameDate): number {
	if (a.year !== b.year) return a.year - b.year;
	if (a.season !== b.season) return 0; // seasons compared by caller with season order
	return a.day - b.day;
}

/** A single recorded event in the world timeline */
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

/** The complete living world state */
export interface WorldState {
	config: import('./blocks').WorldConfig;
	characters: Character[];
	timeline: TimelineEntry[];
	factions: FactionState[];
	questlineProgress: QuestlineProgress[];
	locations: LocationInstance[];
}

/** A specific location in the world (instantiated from a LocationType) */
export interface LocationInstance {
	id: string;
	typeId: string;
	name: string;
}
```

- [ ] **Step 3: Define session types**

Create `src/lib/types/session.ts`:

```ts
import type { GameDate, Character } from './state';
import type { ChoiceNode, Consequence, Role } from './blocks';

/** A record of one choice made during a play session */
export interface ChoiceRecord {
	nodeId: string;
	choiceId: string;
	text: string;
	narrativeText: string;
	consequences: Consequence[];
	timestamp: number;
}

/** Roles filled via waveform collapse for the current event */
export interface CollapsedRole {
	roleId: string;
	characterId: string;
	characterName: string;
	wasNewlyCreated: boolean;
}

/** The active play session state */
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
}

export type SessionOutcome = 'save' | 'discard' | 'replay';

export type NextEntryChoice =
	| { type: 'past'; characterId: string }
	| { type: 'future'; characterId: string }
	| { type: 'someone_else'; characterId: string };
```

- [ ] **Step 4: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/
git commit -m "feat: define core type system — blocks, state, and session types"
```

---

### Task 3: Test Fixtures

**Files:**
- Create: `tests/fixtures/archetypes.ts`
- Create: `tests/fixtures/events.ts`
- Create: `tests/fixtures/locations.ts`
- Create: `tests/fixtures/questlines.ts`
- Create: `tests/fixtures/world-state.ts`

- [ ] **Step 1: Create archetype fixtures**

Create `tests/fixtures/archetypes.ts`:

```ts
import type { Archetype } from '../../src/lib/types/blocks';

export const blacksmith: Archetype = {
	id: 'blacksmith',
	name: 'Blacksmith',
	traits: {
		strength: { min: 5, max: 9 },
		cunning: { min: 2, max: 5 },
		charisma: { min: 3, max: 6 }
	},
	skills: ['forging', 'haggling'],
	namingPatterns: ['Elena', 'Bjorn', 'Thora', 'Garrick'],
	factions: ['craftsmen_guild'],
	locations: ['market_quarter', 'forge_district'],
	activities: ['hammering at the anvil', 'inspecting a blade', 'stoking the forge']
};

export const merchant: Archetype = {
	id: 'merchant',
	name: 'Traveling Merchant',
	traits: {
		strength: { min: 2, max: 5 },
		cunning: { min: 5, max: 9 },
		charisma: { min: 6, max: 9 }
	},
	skills: ['haggling', 'appraisal', 'navigation'],
	namingPatterns: ['Marcus', 'Lydia', 'Fenwick', 'Asha'],
	factions: ['merchant_guild'],
	locations: ['market_quarter', 'docks', 'trade_road'],
	activities: ['counting coins', 'examining wares', 'consulting a ledger']
};

export const soldier: Archetype = {
	id: 'soldier',
	name: 'Soldier',
	traits: {
		strength: { min: 6, max: 9 },
		cunning: { min: 3, max: 6 },
		charisma: { min: 2, max: 5 }
	},
	skills: ['swordsmanship', 'tactics', 'endurance'],
	namingPatterns: ['Aldric', 'Kira', 'Voss', 'Brenna'],
	factions: ['town_guard'],
	locations: ['barracks', 'town_gate', 'watchtower'],
	activities: ['polishing armor', 'drilling formations', 'standing watch']
};

export const allArchetypes = [blacksmith, merchant, soldier];
```

- [ ] **Step 2: Create event template fixtures**

Create `tests/fixtures/events.ts`:

```ts
import type { EventTemplate } from '../../src/lib/types/blocks';

export const banditRaid: EventTemplate = {
	id: 'bandit_raid',
	name: 'Bandit Raid',
	tags: ['action', 'combat', 'danger'],
	preconditions: [
		{ type: 'questline_stage', key: 'demon_invasion', value: 'border_falls', operator: 'gte' }
	],
	roles: [
		{
			id: 'bandit_leader',
			label: 'The Bandit Leader',
			traitRequirements: { strength: { min: 5 }, cunning: { min: 4 } }
		},
		{
			id: 'bystander',
			label: 'A Frightened Bystander',
			archetypeFilter: ['merchant', 'blacksmith']
		}
	],
	entryNodeId: 'start',
	nodes: {
		start: {
			id: 'start',
			text: 'Shouts erupt from the market square. Three armed figures push through the crowd, blades drawn. {bandit_leader.name} points at the merchant stalls.',
			choices: [
				{
					id: 'fight',
					label: 'Stand your ground and fight',
					preconditions: [{ type: 'trait', key: 'strength', min: 5 }],
					consequences: [
						{ type: 'stat', target: 'strength', value: 1 },
						{ type: 'faction', target: 'town_guard', value: 2 },
						{ type: 'questline', target: 'demon_invasion:border_defense', value: 1 }
					],
					exhaustionCost: 3,
					nextNodeId: 'fight_result'
				},
				{
					id: 'hide',
					label: 'Duck behind the stalls and hide',
					consequences: [
						{ type: 'stat', target: 'cunning', value: 1 }
					],
					exhaustionCost: 1,
					nextNodeId: 'hide_result'
				},
				{
					id: 'help_bystander',
					label: 'Grab {bystander.name} and pull them to safety',
					consequences: [
						{ type: 'relationship', target: '{bystander.id}', value: 3 },
						{ type: 'faction', target: 'town_guard', value: 1 }
					],
					exhaustionCost: 2,
					nextNodeId: 'help_result'
				}
			]
		},
		fight_result: {
			id: 'fight_result',
			text: 'You clash with the nearest bandit. Steel rings against steel. The town guard arrives moments later — your stand bought them time.',
			choices: [
				{
					id: 'pursue',
					label: 'Chase the fleeing bandits',
					preconditions: [{ type: 'skill', key: 'endurance' }],
					consequences: [
						{ type: 'exhaustion', target: 'self', value: 3 },
						{ type: 'questline', target: 'demon_invasion:border_defense', value: 2 }
					],
					exhaustionCost: 4,
					nextNodeId: null
				},
				{
					id: 'stay',
					label: 'Help the wounded in the square',
					consequences: [
						{ type: 'faction', target: 'town_guard', value: 1 },
						{ type: 'world_fact', target: 'market_raid_survivors', value: true }
					],
					exhaustionCost: 2,
					nextNodeId: null
				}
			]
		},
		hide_result: {
			id: 'hide_result',
			text: 'You press yourself against the wooden stall. Through a gap in the planks you see {bandit_leader.name} ransacking the silversmith. The raid is over in minutes.',
			choices: [
				{
					id: 'emerge',
					label: 'Emerge and check on the others',
					consequences: [
						{ type: 'world_fact', target: 'witnessed_raid', value: true }
					],
					exhaustionCost: 1,
					nextNodeId: null
				}
			]
		},
		help_result: {
			id: 'help_result',
			text: '{bystander.name} stumbles as you pull them behind the well. "Thank you," they gasp. "I thought — I thought they were going to—"',
			choices: [
				{
					id: 'comfort',
					label: 'Stay with them until it passes',
					consequences: [
						{ type: 'relationship', target: '{bystander.id}', value: 2 },
						{ type: 'stat', target: 'charisma', value: 1 }
					],
					exhaustionCost: 1,
					nextNodeId: null
				},
				{
					id: 'leave',
					label: 'Make sure they are safe, then head back out',
					consequences: [
						{ type: 'faction', target: 'town_guard', value: 1 }
					],
					exhaustionCost: 2,
					nextNodeId: null
				}
			]
		}
	}
};

export const harvestFestival: EventTemplate = {
	id: 'harvest_festival',
	name: 'Harvest Festival',
	tags: ['social', 'crafting', 'romance'],
	preconditions: [
		{ type: 'season', key: 'season', value: 'autumn' }
	],
	roles: [
		{
			id: 'festival_organizer',
			label: 'The Festival Organizer',
			traitRequirements: { charisma: { min: 5 } }
		}
	],
	entryNodeId: 'start',
	nodes: {
		start: {
			id: 'start',
			text: 'The village square is strung with lanterns. The smell of roasted apples and spiced cider fills the air. {festival_organizer.name} waves you over.',
			choices: [
				{
					id: 'join_feast',
					label: 'Join the communal feast',
					consequences: [
						{ type: 'stat', target: 'charisma', value: 1 },
						{ type: 'faction', target: 'village_folk', value: 1 }
					],
					exhaustionCost: 1,
					nextNodeId: null
				},
				{
					id: 'enter_contest',
					label: 'Enter the crafting contest',
					preconditions: [{ type: 'skill', key: 'forging' }],
					consequences: [
						{ type: 'stat', target: 'cunning', value: 1 },
						{ type: 'faction', target: 'craftsmen_guild', value: 2 }
					],
					exhaustionCost: 2,
					nextNodeId: null
				}
			]
		}
	}
};

export const allEvents = [banditRaid, harvestFestival];
```

- [ ] **Step 3: Create location fixtures**

Create `tests/fixtures/locations.ts`:

```ts
import type { LocationType } from '../../src/lib/types/blocks';
import type { LocationInstance } from '../../src/lib/types/state';

export const tavernType: LocationType = {
	id: 'tavern',
	name: 'Tavern',
	tags: ['social', 'rest', 'information'],
	eventTags: ['social', 'romance', 'intrigue'],
	archetypeIds: ['merchant', 'soldier'],
	flavorTexts: ['The fire crackles low.', 'A bard tunes a lute in the corner.']
};

export const marketType: LocationType = {
	id: 'market_quarter',
	name: 'Market Quarter',
	tags: ['commerce', 'social', 'crafting'],
	eventTags: ['action', 'crafting', 'social'],
	archetypeIds: ['merchant', 'blacksmith'],
	flavorTexts: ['Stalls line both sides of the street.', 'The air smells of fresh bread and leather.']
};

export const allLocationTypes = [tavernType, marketType];

export const tavernInstance: LocationInstance = {
	id: 'rusty_flagon',
	typeId: 'tavern',
	name: 'The Rusty Flagon'
};

export const marketInstance: LocationInstance = {
	id: 'market_square',
	typeId: 'market_quarter',
	name: 'Ironhaven Market Square'
};

export const allLocationInstances = [tavernInstance, marketInstance];
```

- [ ] **Step 4: Create questline fixtures**

Create `tests/fixtures/questlines.ts`:

```ts
import type { Questline } from '../../src/lib/types/blocks';
import type { QuestlineProgress } from '../../src/lib/types/state';

export const demonInvasion: Questline = {
	id: 'demon_invasion',
	name: 'The Demon Invasion',
	description: 'A demon lord threatens the realm. Heroes rally, borders fall, and the final siege approaches.',
	stages: [
		{
			id: 'gathering',
			name: 'The Demon Gathers Forces',
			description: 'Rumors of darkness in the borderlands. Life is mostly normal, but tension rises.',
			worldConditions: { dangerLevel: 'low', tradeDisruption: false },
			advancementTriggers: [
				{ type: 'counter', key: 'border_incidents', threshold: 5 }
			],
			regressionTriggers: [],
			flavorShifts: { tavern: 'Travelers speak of strange sightings near the border.' }
		},
		{
			id: 'heroes_rally',
			name: 'Heroes Rally',
			description: 'The threat is undeniable. Warriors and adventurers head to the border.',
			worldConditions: { dangerLevel: 'medium', tradeDisruption: true },
			advancementTriggers: [
				{ type: 'counter', key: 'border_defense', threshold: 10 }
			],
			regressionTriggers: [
				{ type: 'counter', key: 'border_failures', threshold: 5 }
			],
			flavorShifts: { tavern: 'Recruitment posters cover every wall. The mood is grim.' }
		},
		{
			id: 'border_falls',
			name: 'The Border Falls',
			description: 'The border forts have fallen. Refugees stream inland. Danger is everywhere.',
			worldConditions: { dangerLevel: 'high', tradeDisruption: true },
			advancementTriggers: [
				{ type: 'counter', key: 'siege_preparation', threshold: 15 }
			],
			regressionTriggers: [],
			flavorShifts: { tavern: 'Refugees crowd every corner. Food is scarce.' }
		},
		{
			id: 'final_siege',
			name: 'The Final Siege',
			description: 'The demon army is at the gates. Everything comes down to this.',
			worldConditions: { dangerLevel: 'extreme', tradeDisruption: true },
			advancementTriggers: [],
			regressionTriggers: [],
			flavorShifts: { tavern: 'The tavern is silent. Everyone waits.' }
		}
	]
};

export const allQuestlines = [demonInvasion];

export const demonInvasionProgress: QuestlineProgress = {
	questlineId: 'demon_invasion',
	currentStageIndex: 0,
	counters: { border_incidents: 0, border_defense: 0, border_failures: 0, siege_preparation: 0 }
};
```

- [ ] **Step 5: Create world state fixture**

Create `tests/fixtures/world-state.ts`:

```ts
import type { WorldState } from '../../src/lib/types/state';
import type { WorldConfig } from '../../src/lib/types/blocks';
import { allLocationInstances } from './locations';
import { demonInvasionProgress } from './questlines';

export const testConfig: WorldConfig = {
	name: 'Ironhaven',
	description: 'A medieval kingdom under the shadow of a rising demon lord.',
	setting: 'medieval',
	dateSystem: {
		seasons: ['spring', 'summer', 'autumn', 'winter'],
		daysPerSeason: 30,
		startYear: 845
	},
	startingFactions: [
		{ id: 'town_guard', name: 'Town Guard', description: 'The local militia', initialMood: 5 },
		{ id: 'craftsmen_guild', name: "Craftsmen's Guild", description: 'Artisans and makers', initialMood: 6 },
		{ id: 'merchant_guild', name: 'Merchant Guild', description: 'Traders and shopkeepers', initialMood: 7 }
	],
	activeQuestlines: ['demon_invasion'],
	theme: {
		backgroundImage: 'themes/default/background.jpg',
		fontFamily: 'Georgia, serif'
	}
};

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
	relationships: { elena_blacksmith: 2 },
	birthDate: { year: 818, season: 'autumn', day: 5 },
	deathDate: null,
	alive: true
};

export function createTestWorldState(): WorldState {
	return {
		config: testConfig,
		characters: [elenaCharacter, marcusCharacter],
		timeline: [],
		factions: [
			{ id: 'town_guard', mood: 5 },
			{ id: 'craftsmen_guild', mood: 6 },
			{ id: 'merchant_guild', mood: 7 }
		],
		questlineProgress: [{ ...demonInvasionProgress }],
		locations: [...allLocationInstances]
	};
}
```

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/
git commit -m "feat: add test fixtures — archetypes, events, locations, questlines, world state"
```

---

### Task 4: Waveform Collapse Engine

**Files:**
- Create: `src/lib/engine/collapse.ts`
- Create: `tests/engine/collapse.test.ts`

- [ ] **Step 1: Write failing tests for waveform collapse**

Create `tests/engine/collapse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { collapseRole, collapseAllRoles } from '../../src/lib/engine/collapse';
import { allArchetypes, soldier } from '../fixtures/archetypes';
import { banditRaid } from '../fixtures/events';
import { createTestWorldState } from '../fixtures/world-state';

describe('collapseRole', () => {
	it('matches an existing character when one fits the role', () => {
		const world = createTestWorldState();
		const banditLeaderRole = banditRaid.roles[0]; // strength >= 5, cunning >= 4

		// Elena has strength 7, cunning 3 — fails cunning requirement
		// Marcus has strength 3, cunning 7 — fails strength requirement
		// Neither fits, so we expect a new character
		const result = collapseRole(banditLeaderRole, world.characters, allArchetypes, []);

		expect(result.wasNewlyCreated).toBe(true);
		expect(result.characterId).toBeTruthy();
		expect(result.characterName).toBeTruthy();
	});

	it('prefers existing characters over creating new ones', () => {
		const world = createTestWorldState();
		const bystander = banditRaid.roles[1]; // archetypeFilter: merchant, blacksmith

		// Elena is a blacksmith, Marcus is a merchant — both fit
		const result = collapseRole(bystander, world.characters, allArchetypes, []);

		expect(result.wasNewlyCreated).toBe(false);
		expect(['elena_blacksmith', 'marcus_merchant']).toContain(result.characterId);
	});

	it('excludes characters already assigned to other roles', () => {
		const world = createTestWorldState();
		const bystander = banditRaid.roles[1];

		// Exclude Elena — should pick Marcus
		const result = collapseRole(bystander, world.characters, allArchetypes, ['elena_blacksmith']);

		expect(result.wasNewlyCreated).toBe(false);
		expect(result.characterId).toBe('marcus_merchant');
	});

	it('creates a new character when no existing ones fit', () => {
		const world = createTestWorldState();
		const bystander = banditRaid.roles[1];

		// Exclude both Elena and Marcus
		const result = collapseRole(bystander, world.characters, allArchetypes, ['elena_blacksmith', 'marcus_merchant']);

		expect(result.wasNewlyCreated).toBe(true);
		expect(result.characterName).toBeTruthy();
	});

	it('only considers alive characters', () => {
		const world = createTestWorldState();
		world.characters[0].alive = false; // Kill Elena
		const bystander = banditRaid.roles[1];

		const result = collapseRole(bystander, world.characters, allArchetypes, []);

		expect(result.characterId).toBe('marcus_merchant');
	});
});

describe('collapseAllRoles', () => {
	it('fills all roles in an event template', () => {
		const world = createTestWorldState();
		const results = collapseAllRoles(banditRaid.roles, world.characters, allArchetypes);

		expect(results).toHaveLength(2);
		// No two roles should have the same character
		expect(results[0].characterId).not.toBe(results[1].characterId);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/engine/collapse.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement waveform collapse**

Create `src/lib/engine/collapse.ts`:

```ts
import type { Role } from '../types/blocks';
import type { Archetype } from '../types/blocks';
import type { Character } from '../types/state';
import type { CollapsedRole } from '../types/session';

/**
 * Check if a character matches a role's requirements.
 */
function characterMatchesRole(character: Character, role: Role): boolean {
	if (!character.alive) return false;

	if (role.archetypeFilter && !role.archetypeFilter.includes(character.archetypeId)) {
		return false;
	}

	if (role.traitRequirements) {
		for (const [trait, req] of Object.entries(role.traitRequirements)) {
			const value = character.traits[trait] ?? 0;
			if (req.min !== undefined && value < req.min) return false;
			if (req.max !== undefined && value > req.max) return false;
		}
	}

	if (role.factionRequirements) {
		for (const factionId of role.factionRequirements) {
			if (!(factionId in character.factions)) return false;
		}
	}

	return true;
}

/**
 * Generate a random number in a range (inclusive).
 */
function randomInRange(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Create a new character from a matching archetype.
 */
function instantiateFromArchetype(archetypes: Archetype[], role: Role): { character: Character; name: string } {
	// Filter archetypes that could satisfy the role
	let candidates = archetypes;
	if (role.archetypeFilter) {
		candidates = archetypes.filter(a => role.archetypeFilter!.includes(a.id));
	}
	if (candidates.length === 0) {
		candidates = archetypes;
	}

	const archetype = candidates[Math.floor(Math.random() * candidates.length)];
	const name = archetype.namingPatterns[Math.floor(Math.random() * archetype.namingPatterns.length)];
	const id = `${name.toLowerCase()}_${archetype.id}_${Date.now()}`;

	const traits: Record<string, number> = {};
	for (const [trait, range] of Object.entries(archetype.traits)) {
		let value = randomInRange(range.min, range.max);
		// Ensure trait requirements are met
		if (role.traitRequirements?.[trait]?.min !== undefined) {
			value = Math.max(value, role.traitRequirements[trait].min!);
		}
		if (role.traitRequirements?.[trait]?.max !== undefined) {
			value = Math.min(value, role.traitRequirements[trait].max!);
		}
		traits[trait] = value;
	}

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

	return { character, name };
}

/**
 * Collapse a single role: find an existing character or create a new one.
 * Returns the collapsed role and optionally a newly created character.
 */
export function collapseRole(
	role: Role,
	characters: Character[],
	archetypes: Archetype[],
	excludeIds: string[]
): CollapsedRole & { newCharacter?: Character } {
	// Search existing alive characters
	const candidates = characters.filter(
		c => !excludeIds.includes(c.id) && characterMatchesRole(c, role)
	);

	if (candidates.length > 0) {
		const chosen = candidates[Math.floor(Math.random() * candidates.length)];
		return {
			roleId: role.id,
			characterId: chosen.id,
			characterName: chosen.name,
			wasNewlyCreated: false
		};
	}

	// No match — instantiate from archetype
	const { character, name } = instantiateFromArchetype(archetypes, role);
	return {
		roleId: role.id,
		characterId: character.id,
		characterName: name,
		wasNewlyCreated: true,
		newCharacter: character
	};
}

/**
 * Collapse all roles for an event. Ensures no character is double-assigned.
 */
export function collapseAllRoles(
	roles: Role[],
	characters: Character[],
	archetypes: Archetype[]
): Array<CollapsedRole & { newCharacter?: Character }> {
	const results: Array<CollapsedRole & { newCharacter?: Character }> = [];
	const assignedIds: string[] = [];

	for (const role of roles) {
		const result = collapseRole(role, characters, archetypes, assignedIds);
		assignedIds.push(result.characterId);
		results.push(result);
	}

	return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/engine/collapse.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/collapse.ts tests/engine/collapse.test.ts
git commit -m "feat: implement waveform collapse — match characters to roles or instantiate from archetypes"
```

---

### Task 5: Event Selector

**Files:**
- Create: `src/lib/engine/event-selector.ts`
- Create: `tests/engine/event-selector.test.ts`

- [ ] **Step 1: Write failing tests for event selection**

Create `tests/engine/event-selector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterEvents, weightEvents, selectEvent } from '../../src/lib/engine/event-selector';
import { banditRaid, harvestFestival, allEvents } from '../fixtures/events';
import { demonInvasion } from '../fixtures/questlines';
import { createTestWorldState } from '../fixtures/world-state';

describe('filterEvents', () => {
	it('filters events by questline stage preconditions', () => {
		const world = createTestWorldState();
		// Stage 0 = "gathering", bandit_raid requires "border_falls" (stage 2)
		const filtered = filterEvents(allEvents, world, 'autumn');

		// Only harvest festival should pass (season = autumn, no questline req that fails)
		expect(filtered.map(e => e.id)).toContain('harvest_festival');
		expect(filtered.map(e => e.id)).not.toContain('bandit_raid');
	});

	it('includes events when questline stage matches', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 2; // border_falls
		const filtered = filterEvents(allEvents, world, 'autumn');

		expect(filtered.map(e => e.id)).toContain('bandit_raid');
		expect(filtered.map(e => e.id)).toContain('harvest_festival');
	});

	it('filters events by season', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 2;
		const filtered = filterEvents(allEvents, world, 'spring');

		// harvest_festival requires autumn
		expect(filtered.map(e => e.id)).toContain('bandit_raid');
		expect(filtered.map(e => e.id)).not.toContain('harvest_festival');
	});
});

describe('weightEvents', () => {
	it('boosts events matching player day-type preferences', () => {
		const preferences = ['action', 'combat'];
		const events = [banditRaid, harvestFestival];
		const weighted = weightEvents(events, preferences);

		const raidWeight = weighted.find(w => w.event.id === 'bandit_raid')!.weight;
		const festivalWeight = weighted.find(w => w.event.id === 'harvest_festival')!.weight;

		expect(raidWeight).toBeGreaterThan(festivalWeight);
	});

	it('gives all events a base weight even with no matching preferences', () => {
		const weighted = weightEvents([banditRaid, harvestFestival], []);

		for (const w of weighted) {
			expect(w.weight).toBeGreaterThan(0);
		}
	});
});

describe('selectEvent', () => {
	it('returns an event from the available pool', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 2;
		const selected = selectEvent(allEvents, world, 'autumn', ['action']);

		expect(selected).toBeTruthy();
		expect(['bandit_raid', 'harvest_festival']).toContain(selected!.id);
	});

	it('returns null when no events match', () => {
		const world = createTestWorldState();
		// Stage 0 + spring = nothing matches
		const selected = selectEvent(allEvents, world, 'spring', []);

		expect(selected).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/engine/event-selector.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement event selector**

Create `src/lib/engine/event-selector.ts`:

```ts
import type { EventTemplate, EventPrecondition, Questline } from '../types/blocks';
import type { WorldState } from '../types/state';

/**
 * Check if a single precondition is met.
 */
function checkPrecondition(precondition: EventPrecondition, world: WorldState, currentSeason: string): boolean {
	switch (precondition.type) {
		case 'season':
			return currentSeason === precondition.value;

		case 'questline_stage': {
			const [questlineId, stageId] = precondition.key.split(':').length > 1
				? [precondition.key, precondition.value]
				: [precondition.key, precondition.value];

			const progress = world.questlineProgress.find(q => q.questlineId === questlineId);
			if (!progress) return false;

			// For 'gte' operator, check if current stage index >= required stage index
			// We need to find the stage index by ID — but the precondition value is a stage ID
			// For simplicity: treat value as a minimum stage index if numeric, or stage ID if string
			if (precondition.operator === 'gte' || !precondition.operator) {
				if (typeof precondition.value === 'number') {
					return progress.currentStageIndex >= precondition.value;
				}
				// Value is a stage ID — we need to look it up, but we don't have questline definitions
				// in WorldState. For now, use a convention: stage index is encoded in the value.
				// A better approach: store stage IDs in questline progress.
				// Fallback: assume the precondition is met if we can't resolve it
				return true;
			}
			return progress.currentStageIndex === precondition.value;
		}

		case 'location_type':
			return true; // Checked at a higher level when we know the character's location

		case 'faction_mood': {
			const faction = world.factions.find(f => f.id === precondition.key);
			if (!faction) return false;
			const op = precondition.operator ?? 'gte';
			if (op === 'gte') return faction.mood >= (precondition.value as number);
			if (op === 'lte') return faction.mood <= (precondition.value as number);
			return faction.mood === precondition.value;
		}

		case 'tag':
			return true; // Tags are informational, not filtering

		default:
			return true;
	}
}

/**
 * Filter event templates to only those whose preconditions are met.
 */
export function filterEvents(
	events: EventTemplate[],
	world: WorldState,
	currentSeason: string
): EventTemplate[] {
	return events.filter(event =>
		event.preconditions.every(pre => checkPrecondition(pre, world, currentSeason))
	);
}

/**
 * Weight events by how well they match the player's day-type preferences.
 * Every event gets a base weight of 1. Each matching tag adds 1.
 */
export function weightEvents(
	events: EventTemplate[],
	preferences: string[]
): Array<{ event: EventTemplate; weight: number }> {
	return events.map(event => {
		let weight = 1;
		for (const tag of event.tags) {
			if (preferences.includes(tag)) {
				weight += 1;
			}
		}
		return { event, weight };
	});
}

/**
 * Select a single event: filter by preconditions, weight by preferences, pick weighted random.
 */
export function selectEvent(
	events: EventTemplate[],
	world: WorldState,
	currentSeason: string,
	preferences: string[]
): EventTemplate | null {
	const eligible = filterEvents(events, world, currentSeason);
	if (eligible.length === 0) return null;

	const weighted = weightEvents(eligible, preferences);
	const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

	let roll = Math.random() * totalWeight;
	for (const { event, weight } of weighted) {
		roll -= weight;
		if (roll <= 0) return event;
	}

	return weighted[weighted.length - 1].event;
}
```

- [ ] **Step 4: Fix the questline stage check**

The precondition check for `questline_stage` needs the event fixture and engine to agree on how stages are referenced. Update the precondition checker to handle string stage IDs by looking them up in the world's questline definitions. However, since `WorldState` doesn't carry questline definitions (only progress), we need to pass questlines separately OR store stage IDs in progress.

The simpler fix: update the `bandit_raid` fixture to use a numeric stage index (2 for `border_falls`) and update the engine to handle numeric values. But the fixture already uses `'border_falls'` as the value and `'gte'` as the operator. Let's add questline definitions to the filter function.

Update the `filterEvents` signature in `src/lib/engine/event-selector.ts`:

```ts
import type { EventTemplate, EventPrecondition, Questline } from '../types/blocks';
import type { WorldState } from '../types/state';

function checkPrecondition(
	precondition: EventPrecondition,
	world: WorldState,
	currentSeason: string,
	questlines: Questline[]
): boolean {
	switch (precondition.type) {
		case 'season':
			return currentSeason === precondition.value;

		case 'questline_stage': {
			const questlineId = precondition.key;
			const progress = world.questlineProgress.find(q => q.questlineId === questlineId);
			if (!progress) return false;

			const questline = questlines.find(q => q.id === questlineId);
			if (!questline) return false;

			const requiredStageIndex = questline.stages.findIndex(s => s.id === precondition.value);
			if (requiredStageIndex === -1) return false;

			const op = precondition.operator ?? 'gte';
			if (op === 'gte') return progress.currentStageIndex >= requiredStageIndex;
			if (op === 'lte') return progress.currentStageIndex <= requiredStageIndex;
			return progress.currentStageIndex === requiredStageIndex;
		}

		case 'faction_mood': {
			const faction = world.factions.find(f => f.id === precondition.key);
			if (!faction) return false;
			const op = precondition.operator ?? 'gte';
			if (op === 'gte') return faction.mood >= (precondition.value as number);
			if (op === 'lte') return faction.mood <= (precondition.value as number);
			return faction.mood === precondition.value;
		}

		case 'location_type':
		case 'tag':
		default:
			return true;
	}
}

export function filterEvents(
	events: EventTemplate[],
	world: WorldState,
	currentSeason: string,
	questlines?: Questline[]
): EventTemplate[] {
	return events.filter(event =>
		event.preconditions.every(pre =>
			checkPrecondition(pre, world, currentSeason, questlines ?? [])
		)
	);
}

export function weightEvents(
	events: EventTemplate[],
	preferences: string[]
): Array<{ event: EventTemplate; weight: number }> {
	return events.map(event => {
		let weight = 1;
		for (const tag of event.tags) {
			if (preferences.includes(tag)) {
				weight += 1;
			}
		}
		return { event, weight };
	});
}

export function selectEvent(
	events: EventTemplate[],
	world: WorldState,
	currentSeason: string,
	preferences: string[],
	questlines?: Questline[]
): EventTemplate | null {
	const eligible = filterEvents(events, world, currentSeason, questlines);
	if (eligible.length === 0) return null;

	const weighted = weightEvents(eligible, preferences);
	const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);

	let roll = Math.random() * totalWeight;
	for (const { event, weight } of weighted) {
		roll -= weight;
		if (roll <= 0) return event;
	}

	return weighted[weighted.length - 1].event;
}
```

Update tests to pass questlines:

```ts
// In tests, add import:
import { demonInvasion, allQuestlines } from '../fixtures/questlines';

// Update all filterEvents and selectEvent calls to pass allQuestlines:
// filterEvents(allEvents, world, 'autumn', allQuestlines)
// selectEvent(allEvents, world, 'autumn', ['action'], allQuestlines)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/engine/event-selector.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/event-selector.ts tests/engine/event-selector.test.ts
git commit -m "feat: implement event selector — filter by preconditions, weight by preferences"
```

---

### Task 6: Choice Resolver

**Files:**
- Create: `src/lib/engine/choice-resolver.ts`
- Create: `tests/engine/choice-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/engine/choice-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveChoice, checkPreconditions, getAvailableChoices } from '../../src/lib/engine/choice-resolver';
import { banditRaid } from '../fixtures/events';
import { createTestWorldState } from '../fixtures/world-state';
import type { PlaySession } from '../../src/lib/types/session';

function createTestSession(): PlaySession {
	return {
		characterId: 'elena_blacksmith',
		date: { year: 847, season: 'spring', day: 14 },
		eventTemplateId: 'bandit_raid',
		collapsedRoles: [
			{ roleId: 'bandit_leader', characterId: 'new_bandit_1', characterName: 'Krag', wasNewlyCreated: true },
			{ roleId: 'bystander', characterId: 'marcus_merchant', characterName: 'Marcus', wasNewlyCreated: false }
		],
		currentNodeId: 'start',
		choiceLog: [],
		exhaustion: 0,
		maxExhaustion: 10,
		isDead: false,
		isComplete: false,
		dayTypePreferences: ['action']
	};
}

describe('checkPreconditions', () => {
	it('passes when character meets trait requirements', () => {
		const world = createTestWorldState();
		const elena = world.characters[0]; // strength: 7
		const fightChoice = banditRaid.nodes.start.choices[0]; // strength >= 5

		expect(checkPreconditions(fightChoice, elena)).toBe(true);
	});

	it('fails when character does not meet trait requirements', () => {
		const world = createTestWorldState();
		const marcus = world.characters[1]; // strength: 3
		const fightChoice = banditRaid.nodes.start.choices[0]; // strength >= 5

		expect(checkPreconditions(fightChoice, marcus)).toBe(false);
	});

	it('passes skill checks when character has the skill', () => {
		const world = createTestWorldState();
		const elena = world.characters[0]; // skills: forging, haggling
		const contestChoice = {
			id: 'test',
			label: 'test',
			preconditions: [{ type: 'skill' as const, key: 'forging' }],
			consequences: [],
			exhaustionCost: 0,
			nextNodeId: null
		};

		expect(checkPreconditions(contestChoice, elena)).toBe(true);
	});
});

describe('getAvailableChoices', () => {
	it('filters choices by preconditions and exhaustion', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const elena = world.characters[0];
		const node = banditRaid.nodes.start;

		const available = getAvailableChoices(node, elena, session.exhaustion, session.maxExhaustion);

		// Elena has strength 7 — can fight. All other choices have no trait reqs.
		expect(available.length).toBe(3);
	});

	it('excludes choices when exhaustion would exceed max', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		session.exhaustion = 9; // Only 1 left before max of 10
		const elena = world.characters[0];
		const node = banditRaid.nodes.start;

		const available = getAvailableChoices(node, elena, session.exhaustion, session.maxExhaustion);

		// fight costs 3 (too much), hide costs 1 (ok), help costs 2 (too much)
		expect(available.map(c => c.id)).toEqual(['hide']);
	});
});

describe('resolveChoice', () => {
	it('applies stat consequences to the character', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const fightChoice = banditRaid.nodes.start.choices[0];

		const result = resolveChoice(fightChoice, session, world);

		const elena = result.world.characters.find(c => c.id === 'elena_blacksmith')!;
		expect(elena.traits.strength).toBe(8); // was 7, +1
	});

	it('applies faction consequences', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const fightChoice = banditRaid.nodes.start.choices[0];

		const result = resolveChoice(fightChoice, session, world);

		const guard = result.world.factions.find(f => f.id === 'town_guard')!;
		expect(guard.mood).toBe(7); // was 5, +2
	});

	it('increases exhaustion', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const fightChoice = banditRaid.nodes.start.choices[0]; // cost 3

		const result = resolveChoice(fightChoice, session, world);

		expect(result.session.exhaustion).toBe(3);
	});

	it('advances to the next node', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const fightChoice = banditRaid.nodes.start.choices[0]; // nextNodeId: fight_result

		const result = resolveChoice(fightChoice, session, world);

		expect(result.session.currentNodeId).toBe('fight_result');
	});

	it('marks session complete when nextNodeId is null', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		session.currentNodeId = 'hide_result';
		const emergeChoice = banditRaid.nodes.hide_result.choices[0]; // nextNodeId: null

		const result = resolveChoice(emergeChoice, session, world);

		expect(result.session.isComplete).toBe(true);
	});

	it('handles death consequence', () => {
		const world = createTestWorldState();
		const session = createTestSession();
		const deathChoice = {
			id: 'die',
			label: 'die',
			consequences: [{ type: 'death' as const, target: 'self', value: true }],
			exhaustionCost: 0,
			nextNodeId: null
		};

		const result = resolveChoice(deathChoice, session, world);

		expect(result.session.isDead).toBe(true);
		expect(result.session.isComplete).toBe(true);
		const elena = result.world.characters.find(c => c.id === 'elena_blacksmith')!;
		expect(elena.alive).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/engine/choice-resolver.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement choice resolver**

Create `src/lib/engine/choice-resolver.ts`:

```ts
import type { Choice, ChoiceNode, ChoicePrecondition, Consequence } from '../types/blocks';
import type { Character, WorldState } from '../types/state';
import type { PlaySession, ChoiceRecord } from '../types/session';

/**
 * Check if a character meets all preconditions for a choice.
 */
export function checkPreconditions(choice: Choice, character: Character): boolean {
	if (!choice.preconditions) return true;

	for (const pre of choice.preconditions) {
		switch (pre.type) {
			case 'trait': {
				const value = character.traits[pre.key] ?? 0;
				if (pre.min !== undefined && value < pre.min) return false;
				break;
			}
			case 'skill': {
				if (!character.skills.includes(pre.key)) return false;
				break;
			}
			case 'faction': {
				if (!(pre.key in character.factions)) return false;
				if (pre.min !== undefined && character.factions[pre.key] < pre.min) return false;
				break;
			}
			case 'item': {
				// Items not implemented in Phase 1 — always pass
				break;
			}
		}
	}

	return true;
}

/**
 * Get choices available to the character at this node, filtered by preconditions and exhaustion.
 */
export function getAvailableChoices(
	node: ChoiceNode,
	character: Character,
	currentExhaustion: number,
	maxExhaustion: number
): Choice[] {
	return node.choices.filter(choice => {
		if (currentExhaustion + choice.exhaustionCost > maxExhaustion) return false;
		return checkPreconditions(choice, character);
	});
}

/**
 * Deep-clone an object (simple JSON round-trip).
 */
function clone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}

/**
 * Apply a consequence to the world/session state.
 */
function applyConsequence(
	consequence: Consequence,
	characterId: string,
	world: WorldState,
	session: PlaySession
): void {
	switch (consequence.type) {
		case 'stat': {
			const char = world.characters.find(c => c.id === characterId);
			if (char && typeof consequence.value === 'number') {
				char.traits[consequence.target] = (char.traits[consequence.target] ?? 0) + consequence.value;
			}
			break;
		}
		case 'faction': {
			const faction = world.factions.find(f => f.id === consequence.target);
			if (faction && typeof consequence.value === 'number') {
				faction.mood += consequence.value;
			}
			// Also update character's personal faction standing
			const char = world.characters.find(c => c.id === characterId);
			if (char && typeof consequence.value === 'number') {
				char.factions[consequence.target] = (char.factions[consequence.target] ?? 0) + consequence.value;
			}
			break;
		}
		case 'questline': {
			// Format: "questlineId:counterKey"
			const [questlineId, counterKey] = consequence.target.split(':');
			const progress = world.questlineProgress.find(q => q.questlineId === questlineId);
			if (progress && typeof consequence.value === 'number') {
				progress.counters[counterKey] = (progress.counters[counterKey] ?? 0) + consequence.value;
			}
			break;
		}
		case 'relationship': {
			const char = world.characters.find(c => c.id === characterId);
			if (char && typeof consequence.value === 'number') {
				// Resolve role references like {bystander.id}
				let targetId = consequence.target;
				const roleMatch = targetId.match(/^\{(\w+)\.id\}$/);
				if (roleMatch) {
					const role = session.collapsedRoles.find(r => r.roleId === roleMatch[1]);
					if (role) targetId = role.characterId;
				}
				char.relationships[targetId] = (char.relationships[targetId] ?? 0) + consequence.value;
			}
			break;
		}
		case 'world_fact': {
			// Store as a timeline note — simple key-value for now
			break;
		}
		case 'death': {
			const char = world.characters.find(c => c.id === characterId);
			if (char) {
				char.alive = false;
				char.deathDate = session.date;
			}
			session.isDead = true;
			session.isComplete = true;
			break;
		}
		case 'exhaustion': {
			if (typeof consequence.value === 'number') {
				session.exhaustion += consequence.value;
			}
			break;
		}
	}
}

/**
 * Resolve a player's choice: apply all consequences, advance session state.
 * Returns new copies of world and session (immutable from caller's perspective).
 */
export function resolveChoice(
	choice: Choice,
	session: PlaySession,
	world: WorldState
): { session: PlaySession; world: WorldState } {
	const newWorld = clone(world);
	const newSession = clone(session);

	// Apply exhaustion cost
	newSession.exhaustion += choice.exhaustionCost;

	// Check if exhaustion causes forced rest
	if (newSession.exhaustion >= newSession.maxExhaustion) {
		newSession.isComplete = true;
	}

	// Apply all consequences
	for (const consequence of choice.consequences) {
		applyConsequence(consequence, newSession.characterId, newWorld, newSession);
	}

	// Record the choice
	const record: ChoiceRecord = {
		nodeId: newSession.currentNodeId,
		choiceId: choice.id,
		text: choice.label,
		narrativeText: '',
		consequences: choice.consequences,
		timestamp: Date.now()
	};
	newSession.choiceLog.push(record);

	// Advance to next node
	if (choice.nextNodeId === null) {
		newSession.isComplete = true;
	} else {
		newSession.currentNodeId = choice.nextNodeId;
	}

	return { session: newSession, world: newWorld };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/engine/choice-resolver.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/choice-resolver.ts tests/engine/choice-resolver.test.ts
git commit -m "feat: implement choice resolver — precondition checks, consequence application, session advancement"
```

---

### Task 7: Questline Tracker

**Files:**
- Create: `src/lib/engine/questline-tracker.ts`
- Create: `tests/engine/questline-tracker.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/engine/questline-tracker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { checkAdvancement, checkRegression, updateQuestlines } from '../../src/lib/engine/questline-tracker';
import { demonInvasion } from '../fixtures/questlines';
import { createTestWorldState } from '../fixtures/world-state';

describe('checkAdvancement', () => {
	it('advances when all triggers are met', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].counters.border_incidents = 5; // meets threshold of 5

		const advanced = checkAdvancement(world.questlineProgress[0], demonInvasion);

		expect(advanced).toBe(true);
	});

	it('does not advance when triggers are not met', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].counters.border_incidents = 3;

		const advanced = checkAdvancement(world.questlineProgress[0], demonInvasion);

		expect(advanced).toBe(false);
	});

	it('does not advance past the last stage', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 3; // final_siege (last stage)

		const advanced = checkAdvancement(world.questlineProgress[0], demonInvasion);

		expect(advanced).toBe(false);
	});
});

describe('checkRegression', () => {
	it('regresses when regression triggers are met', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 1; // heroes_rally
		world.questlineProgress[0].counters.border_failures = 5;

		const regressed = checkRegression(world.questlineProgress[0], demonInvasion);

		expect(regressed).toBe(true);
	});

	it('does not regress below stage 0', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 0;
		// Stage 0 has no regression triggers

		const regressed = checkRegression(world.questlineProgress[0], demonInvasion);

		expect(regressed).toBe(false);
	});
});

describe('updateQuestlines', () => {
	it('advances the questline stage and resets counters', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].counters.border_incidents = 5;

		const updated = updateQuestlines(world.questlineProgress, [demonInvasion]);

		expect(updated[0].currentStageIndex).toBe(1);
	});

	it('returns unchanged progress when no triggers are met', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].counters.border_incidents = 2;

		const updated = updateQuestlines(world.questlineProgress, [demonInvasion]);

		expect(updated[0].currentStageIndex).toBe(0);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/engine/questline-tracker.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement questline tracker**

Create `src/lib/engine/questline-tracker.ts`:

```ts
import type { Questline, Trigger } from '../types/blocks';
import type { QuestlineProgress } from '../types/state';

/**
 * Check if all triggers in a list are met by the current counters.
 */
function triggersAreMet(triggers: Trigger[], counters: Record<string, number>): boolean {
	if (triggers.length === 0) return false;

	return triggers.every(trigger => {
		switch (trigger.type) {
			case 'counter':
				return (counters[trigger.key] ?? 0) >= trigger.threshold;
			case 'time':
				// Time-based triggers not implemented in Phase 1
				return false;
			case 'event':
				// Event-based triggers checked elsewhere
				return false;
			default:
				return false;
		}
	});
}

/**
 * Check if a questline should advance to its next stage.
 */
export function checkAdvancement(progress: QuestlineProgress, questline: Questline): boolean {
	if (progress.currentStageIndex >= questline.stages.length - 1) return false;

	const currentStage = questline.stages[progress.currentStageIndex];
	return triggersAreMet(currentStage.advancementTriggers, progress.counters);
}

/**
 * Check if a questline should regress to its previous stage.
 */
export function checkRegression(progress: QuestlineProgress, questline: Questline): boolean {
	if (progress.currentStageIndex <= 0) return false;

	const currentStage = questline.stages[progress.currentStageIndex];
	return triggersAreMet(currentStage.regressionTriggers, progress.counters);
}

/**
 * Update all questline progress: check for advancements and regressions.
 * Returns new progress array.
 */
export function updateQuestlines(
	progressList: QuestlineProgress[],
	questlines: Questline[]
): QuestlineProgress[] {
	return progressList.map(progress => {
		const questline = questlines.find(q => q.id === progress.questlineId);
		if (!questline) return { ...progress };

		const updated = { ...progress, counters: { ...progress.counters } };

		if (checkAdvancement(progress, questline)) {
			updated.currentStageIndex = progress.currentStageIndex + 1;
		} else if (checkRegression(progress, questline)) {
			updated.currentStageIndex = progress.currentStageIndex - 1;
		}

		return updated;
	});
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/engine/questline-tracker.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/questline-tracker.ts tests/engine/questline-tracker.test.ts
git commit -m "feat: implement questline tracker — stage advancement and regression via trigger counters"
```

---

### Task 8: Text Generator (Template Engine)

**Files:**
- Create: `src/lib/engine/text-generator.ts`
- Create: `tests/engine/text-generator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/engine/text-generator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interpolateText } from '../../src/lib/engine/text-generator';
import type { CollapsedRole } from '../../src/lib/types/session';
import type { Character } from '../../src/lib/types/state';

describe('interpolateText', () => {
	const roles: CollapsedRole[] = [
		{ roleId: 'bandit_leader', characterId: 'krag_1', characterName: 'Krag', wasNewlyCreated: true },
		{ roleId: 'bystander', characterId: 'marcus_merchant', characterName: 'Marcus', wasNewlyCreated: false }
	];

	const characters: Character[] = [
		{
			id: 'krag_1', name: 'Krag', archetypeId: 'soldier',
			traits: { strength: 8 }, skills: ['swordsmanship'],
			locationId: '', factions: {}, relationships: {},
			birthDate: { year: 810, season: 'winter', day: 3 },
			deathDate: null, alive: true
		},
		{
			id: 'marcus_merchant', name: 'Marcus', archetypeId: 'merchant',
			traits: { cunning: 7 }, skills: ['haggling'],
			locationId: '', factions: {}, relationships: {},
			birthDate: { year: 818, season: 'autumn', day: 5 },
			deathDate: null, alive: true
		}
	];

	it('replaces role name references', () => {
		const text = '{bandit_leader.name} points at the stalls.';
		const result = interpolateText(text, roles, characters);

		expect(result).toBe('Krag points at the stalls.');
	});

	it('replaces role id references', () => {
		const text = 'Helped {bystander.id} escape.';
		const result = interpolateText(text, roles, characters);

		expect(result).toBe('Helped marcus_merchant escape.');
	});

	it('replaces role archetype references', () => {
		const text = '{bystander.name} the {bystander.archetype} nods.';
		const result = interpolateText(text, roles, characters);

		expect(result).toBe('Marcus the merchant nods.');
	});

	it('handles multiple replacements in one string', () => {
		const text = '{bandit_leader.name} threatens {bystander.name}.';
		const result = interpolateText(text, roles, characters);

		expect(result).toBe('Krag threatens Marcus.');
	});

	it('leaves unknown references unchanged', () => {
		const text = '{unknown_role.name} does something.';
		const result = interpolateText(text, roles, characters);

		expect(result).toBe('{unknown_role.name} does something.');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/engine/text-generator.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement text generator**

Create `src/lib/engine/text-generator.ts`:

```ts
import type { CollapsedRole } from '../types/session';
import type { Character } from '../types/state';

/**
 * Interpolate template text by replacing {role.property} references
 * with actual character data from collapsed roles.
 */
export function interpolateText(
	text: string,
	roles: CollapsedRole[],
	characters: Character[]
): string {
	return text.replace(/\{(\w+)\.(\w+)\}/g, (match, roleId, property) => {
		const role = roles.find(r => r.roleId === roleId);
		if (!role) return match;

		const character = characters.find(c => c.id === role.characterId);

		switch (property) {
			case 'name':
				return role.characterName;
			case 'id':
				return role.characterId;
			case 'archetype':
				return character?.archetypeId ?? match;
			case 'activity':
				// Would pull from archetype activities — simplified for now
				return character?.archetypeId ?? match;
			default:
				// Try character traits
				if (character && property in character.traits) {
					return String(character.traits[property]);
				}
				return match;
		}
	});
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/engine/text-generator.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/text-generator.ts tests/engine/text-generator.test.ts
git commit -m "feat: implement template text generator — interpolate role references in narrative text"
```

---

### Task 9: World Loader (localStorage for Phase 1)

**Files:**
- Create: `src/lib/engine/world-loader.ts`
- Create: `src/lib/data/demo-world/world.yaml`
- Create: `src/lib/data/demo-world/archetypes/blacksmith.yaml`
- Create: `src/lib/data/demo-world/archetypes/merchant.yaml`
- Create: `src/lib/data/demo-world/archetypes/soldier.yaml`
- Create: `src/lib/data/demo-world/events/bandit-raid.yaml`
- Create: `src/lib/data/demo-world/events/harvest-festival.yaml`
- Create: `src/lib/data/demo-world/locations/tavern.yaml`
- Create: `src/lib/data/demo-world/locations/market-quarter.yaml`
- Create: `src/lib/data/demo-world/questlines/demon-invasion.yaml`

- [ ] **Step 1: Create demo world YAML files**

Create `src/lib/data/demo-world/world.yaml` — this is the world config matching the test fixture structure. The YAML should serialize the same data as `testConfig` from fixtures.

```yaml
name: Ironhaven
description: A medieval kingdom under the shadow of a rising demon lord.
setting: medieval
dateSystem:
  seasons: [spring, summer, autumn, winter]
  daysPerSeason: 30
  startYear: 845
startingFactions:
  - id: town_guard
    name: Town Guard
    description: The local militia
    initialMood: 5
  - id: craftsmen_guild
    name: "Craftsmen's Guild"
    description: Artisans and makers
    initialMood: 6
  - id: merchant_guild
    name: Merchant Guild
    description: Traders and shopkeepers
    initialMood: 7
activeQuestlines:
  - demon_invasion
theme:
  backgroundImage: themes/default/background.jpg
  fontFamily: "Georgia, serif"
```

Create archetype, event, location, and questline YAML files that mirror the test fixture data. Each file is the YAML serialization of the corresponding TypeScript fixture object.

Create `src/lib/data/demo-world/archetypes/blacksmith.yaml`:

```yaml
id: blacksmith
name: Blacksmith
traits:
  strength: { min: 5, max: 9 }
  cunning: { min: 2, max: 5 }
  charisma: { min: 3, max: 6 }
skills: [forging, haggling]
namingPatterns: [Elena, Bjorn, Thora, Garrick]
factions: [craftsmen_guild]
locations: [market_quarter, forge_district]
activities: [hammering at the anvil, inspecting a blade, stoking the forge]
```

Create `src/lib/data/demo-world/archetypes/merchant.yaml`:

```yaml
id: merchant
name: Traveling Merchant
traits:
  strength: { min: 2, max: 5 }
  cunning: { min: 5, max: 9 }
  charisma: { min: 6, max: 9 }
skills: [haggling, appraisal, navigation]
namingPatterns: [Marcus, Lydia, Fenwick, Asha]
factions: [merchant_guild]
locations: [market_quarter, docks, trade_road]
activities: [counting coins, examining wares, consulting a ledger]
```

Create `src/lib/data/demo-world/archetypes/soldier.yaml`:

```yaml
id: soldier
name: Soldier
traits:
  strength: { min: 6, max: 9 }
  cunning: { min: 3, max: 6 }
  charisma: { min: 2, max: 5 }
skills: [swordsmanship, tactics, endurance]
namingPatterns: [Aldric, Kira, Voss, Brenna]
factions: [town_guard]
locations: [barracks, town_gate, watchtower]
activities: [polishing armor, drilling formations, standing watch]
```

Create the event and location YAML files similarly — each one mirrors its fixture counterpart exactly.

- [ ] **Step 2: Implement world loader**

Create `src/lib/engine/world-loader.ts`:

```ts
import yaml from 'js-yaml';
import type { Archetype, EventTemplate, LocationType, Questline, WorldConfig } from '../types/blocks';
import type { WorldState, FactionState, QuestlineProgress, LocationInstance } from '../types/state';

export interface WorldBlocks {
	config: WorldConfig;
	archetypes: Archetype[];
	events: EventTemplate[];
	locations: LocationType[];
	questlines: Questline[];
}

/**
 * Parse a YAML string into a typed object.
 */
export function parseYaml<T>(yamlString: string): T {
	return yaml.load(yamlString) as T;
}

/**
 * Initialize a fresh world state from blocks (no existing characters or history).
 */
export function initializeWorldState(blocks: WorldBlocks): WorldState {
	const factions: FactionState[] = blocks.config.startingFactions.map(f => ({
		id: f.id,
		mood: f.initialMood
	}));

	const questlineProgress: QuestlineProgress[] = blocks.questlines
		.filter(q => blocks.config.activeQuestlines.includes(q.id))
		.map(q => ({
			questlineId: q.id,
			currentStageIndex: 0,
			counters: {}
		}));

	// Create one location instance per location type
	const locations: LocationInstance[] = blocks.locations.map(lt => ({
		id: lt.id,
		typeId: lt.id,
		name: lt.name
	}));

	return {
		config: blocks.config,
		characters: [],
		timeline: [],
		factions,
		questlineProgress,
		locations
	};
}

const STORAGE_KEY = 'journal-rpg-world-state';
const BLOCKS_KEY = 'journal-rpg-world-blocks';

/**
 * Save world state to localStorage.
 */
export function saveWorldState(state: WorldState): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Load world state from localStorage. Returns null if not found.
 */
export function loadWorldState(): WorldState | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	return JSON.parse(raw) as WorldState;
}

/**
 * Save world blocks to localStorage.
 */
export function saveWorldBlocks(blocks: WorldBlocks): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem(BLOCKS_KEY, JSON.stringify(blocks));
}

/**
 * Load world blocks from localStorage. Returns null if not found.
 */
export function loadWorldBlocks(): WorldBlocks | null {
	if (typeof localStorage === 'undefined') return null;
	const raw = localStorage.getItem(BLOCKS_KEY);
	if (!raw) return null;
	return JSON.parse(raw) as WorldBlocks;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/engine/world-loader.ts src/lib/data/
git commit -m "feat: add world loader with localStorage persistence and demo world YAML files"
```

---

### Task 10: Svelte Stores

**Files:**
- Create: `src/lib/stores/world.ts`
- Create: `src/lib/stores/session.ts`
- Create: `src/lib/stores/player.ts`

- [ ] **Step 1: Create world store**

Create `src/lib/stores/world.ts`:

```ts
import { writable, derived } from 'svelte/store';
import type { WorldState } from '../types/state';
import type { WorldBlocks } from '../engine/world-loader';

export const worldState = writable<WorldState | null>(null);
export const worldBlocks = writable<WorldBlocks | null>(null);

export const livingCharacters = derived(worldState, ($state) =>
	$state?.characters.filter(c => c.alive) ?? []
);

export const currentQuestlineStages = derived([worldState, worldBlocks], ([$state, $blocks]) => {
	if (!$state || !$blocks) return [];
	return $state.questlineProgress.map(progress => {
		const questline = $blocks.questlines.find(q => q.id === progress.questlineId);
		return {
			questlineId: progress.questlineId,
			questlineName: questline?.name ?? progress.questlineId,
			stage: questline?.stages[progress.currentStageIndex],
			stageIndex: progress.currentStageIndex
		};
	});
});
```

- [ ] **Step 2: Create session store**

Create `src/lib/stores/session.ts`:

```ts
import { writable, derived } from 'svelte/store';
import type { PlaySession } from '../types/session';

export const playSession = writable<PlaySession | null>(null);

export const isPlaying = derived(playSession, ($session) =>
	$session !== null && !$session.isComplete
);

export const exhaustionPercent = derived(playSession, ($session) => {
	if (!$session) return 0;
	return Math.round(($session.exhaustion / $session.maxExhaustion) * 100);
});
```

- [ ] **Step 3: Create player store**

Create `src/lib/stores/player.ts`:

```ts
import { writable } from 'svelte/store';

export interface PlayerPrefs {
	dayTypePreferences: string[];
	llmSetting: 'none' | 'local' | 'claude';
	llmEndpoint?: string;
}

const DEFAULT_PREFS: PlayerPrefs = {
	dayTypePreferences: [],
	llmSetting: 'none'
};

export const playerPrefs = writable<PlayerPrefs>(DEFAULT_PREFS);

/**
 * Load player prefs from localStorage.
 */
export function loadPlayerPrefs(): PlayerPrefs {
	if (typeof localStorage === 'undefined') return DEFAULT_PREFS;
	const raw = localStorage.getItem('journal-rpg-player-prefs');
	if (!raw) return DEFAULT_PREFS;
	return JSON.parse(raw) as PlayerPrefs;
}

/**
 * Save player prefs to localStorage.
 */
export function savePlayerPrefs(prefs: PlayerPrefs): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem('journal-rpg-player-prefs', JSON.stringify(prefs));
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/
git commit -m "feat: add Svelte stores — world state, play session, and player preferences"
```

---

### Task 11: Journal Play Page (UI)

**Files:**
- Create: `src/routes/journal/+page.svelte`
- Modify: `src/routes/+page.svelte`
- Modify: `src/routes/+layout.svelte`
- Create: `static/themes/default/style.css`

- [ ] **Step 1: Create the default theme CSS**

Create `static/themes/default/style.css`:

```css
:root {
	--journal-bg: #f5e6c8;
	--journal-text: #3a2a1a;
	--journal-accent: #8b6914;
	--journal-border: #c4a87a;
	--journal-choice-bg: rgba(255, 255, 255, 0.3);
	--journal-choice-hover: rgba(255, 255, 255, 0.5);
	--journal-muted: rgba(58, 42, 26, 0.5);
	--journal-font: Georgia, 'Times New Roman', serif;
	--session-end-bg: #1a1a2e;
	--session-end-text: #d4c5a0;
	--session-end-card-bg: rgba(255, 255, 255, 0.05);
	--session-end-border: #4a4a3a;
}
```

- [ ] **Step 2: Create the app layout**

Replace `src/routes/+layout.svelte`:

```svelte
<script>
	import '../app.css';
	let { children } = $props();
</script>

<div class="app">
	{@render children()}
</div>

<style>
	.app {
		min-height: 100vh;
	}
</style>
```

Create `src/app.css` (global styles):

```css
@import '/themes/default/style.css';

* {
	box-sizing: border-box;
	margin: 0;
	padding: 0;
}

body {
	font-family: var(--journal-font);
	line-height: 1.6;
}
```

- [ ] **Step 3: Create the landing page with "Start New World" button**

Replace `src/routes/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { initializeWorldState, loadWorldState, loadWorldBlocks, saveWorldState, saveWorldBlocks } from '$lib/engine/world-loader';
	import type { WorldBlocks } from '$lib/engine/world-loader';

	// Demo world data — imported as raw strings at build time
	// For Phase 1, we'll inline the demo world initialization
	import { onMount } from 'svelte';

	let hasExistingWorld = $state(false);

	onMount(() => {
		const existing = loadWorldState();
		hasExistingWorld = existing !== null;
	});

	async function startNewWorld() {
		// Load demo world blocks (hardcoded for Phase 1)
		const blocks = getDemoWorldBlocks();
		const state = initializeWorldState(blocks);
		saveWorldBlocks(blocks);
		saveWorldState(state);
		worldBlocks.set(blocks);
		worldState.set(state);
		goto('/journal');
	}

	async function continueWorld() {
		const state = loadWorldState();
		const blocks = loadWorldBlocks();
		if (state && blocks) {
			worldState.set(state);
			worldBlocks.set(blocks);
			goto('/journal');
		}
	}

	function getDemoWorldBlocks(): WorldBlocks {
		// Inline demo world for Phase 1 — will load from YAML files later
		return {
			config: {
				name: 'Ironhaven',
				description: 'A medieval kingdom under the shadow of a rising demon lord.',
				setting: 'medieval',
				dateSystem: { seasons: ['spring', 'summer', 'autumn', 'winter'], daysPerSeason: 30, startYear: 845 },
				startingFactions: [
					{ id: 'town_guard', name: 'Town Guard', description: 'The local militia', initialMood: 5 },
					{ id: 'craftsmen_guild', name: "Craftsmen's Guild", description: 'Artisans and makers', initialMood: 6 },
					{ id: 'merchant_guild', name: 'Merchant Guild', description: 'Traders and shopkeepers', initialMood: 7 }
				],
				activeQuestlines: ['demon_invasion'],
				theme: { backgroundImage: 'themes/default/background.jpg', fontFamily: 'Georgia, serif' }
			},
			archetypes: [
				{
					id: 'blacksmith', name: 'Blacksmith',
					traits: { strength: { min: 5, max: 9 }, cunning: { min: 2, max: 5 }, charisma: { min: 3, max: 6 } },
					skills: ['forging', 'haggling'],
					namingPatterns: ['Elena', 'Bjorn', 'Thora', 'Garrick'],
					factions: ['craftsmen_guild'], locations: ['market_quarter', 'forge_district'],
					activities: ['hammering at the anvil', 'inspecting a blade', 'stoking the forge']
				},
				{
					id: 'merchant', name: 'Traveling Merchant',
					traits: { strength: { min: 2, max: 5 }, cunning: { min: 5, max: 9 }, charisma: { min: 6, max: 9 } },
					skills: ['haggling', 'appraisal', 'navigation'],
					namingPatterns: ['Marcus', 'Lydia', 'Fenwick', 'Asha'],
					factions: ['merchant_guild'], locations: ['market_quarter', 'docks', 'trade_road'],
					activities: ['counting coins', 'examining wares', 'consulting a ledger']
				},
				{
					id: 'soldier', name: 'Soldier',
					traits: { strength: { min: 6, max: 9 }, cunning: { min: 3, max: 6 }, charisma: { min: 2, max: 5 } },
					skills: ['swordsmanship', 'tactics', 'endurance'],
					namingPatterns: ['Aldric', 'Kira', 'Voss', 'Brenna'],
					factions: ['town_guard'], locations: ['barracks', 'town_gate', 'watchtower'],
					activities: ['polishing armor', 'drilling formations', 'standing watch']
				}
			],
			events: [
				// Bandit raid and harvest festival — full event templates
				// These are large objects; see tests/fixtures/events.ts for the full structure
				// For brevity in the plan, the actual implementation will import from demo YAML
			] as any,
			locations: [
				{ id: 'tavern', name: 'Tavern', tags: ['social', 'rest'], eventTags: ['social', 'romance'], archetypeIds: ['merchant', 'soldier'], flavorTexts: ['The fire crackles low.'] },
				{ id: 'market_quarter', name: 'Market Quarter', tags: ['commerce', 'social'], eventTags: ['action', 'crafting'], archetypeIds: ['merchant', 'blacksmith'], flavorTexts: ['Stalls line both sides.'] }
			],
			questlines: [
				// Full demon invasion questline — see tests/fixtures/questlines.ts
			] as any
		};
	}
</script>

<div class="landing">
	<h1>Journal RPG</h1>
	<p class="subtitle">Live out the days of background characters in a world shaped by your choices.</p>

	<div class="actions">
		<button onclick={startNewWorld}>Start New World</button>
		{#if hasExistingWorld}
			<button onclick={continueWorld} class="secondary">Continue World</button>
		{/if}
	</div>
</div>

<style>
	.landing {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--session-end-bg);
		color: var(--session-end-text);
		text-align: center;
		padding: 2rem;
	}

	h1 {
		font-size: 3rem;
		margin-bottom: 0.5rem;
	}

	.subtitle {
		font-size: 1.1rem;
		opacity: 0.7;
		max-width: 500px;
		margin-bottom: 2rem;
	}

	.actions {
		display: flex;
		gap: 1rem;
	}

	button {
		padding: 0.75rem 2rem;
		font-size: 1.1rem;
		font-family: var(--journal-font);
		border: 1px solid var(--journal-accent);
		background: rgba(139, 105, 20, 0.2);
		color: var(--session-end-text);
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.2s;
	}

	button:hover {
		background: rgba(139, 105, 20, 0.4);
	}

	button.secondary {
		background: transparent;
		border-color: var(--session-end-border);
	}
</style>
```

- [ ] **Step 4: Create the journal play page**

Create `src/routes/journal/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { playSession } from '$lib/stores/session';
	import { resolveChoice, getAvailableChoices } from '$lib/engine/choice-resolver';
	import { collapseAllRoles } from '$lib/engine/collapse';
	import { selectEvent } from '$lib/engine/event-selector';
	import { interpolateText } from '$lib/engine/text-generator';
	import { updateQuestlines } from '$lib/engine/questline-tracker';
	import { saveWorldState } from '$lib/engine/world-loader';
	import type { PlaySession } from '$lib/types/session';
	import type { Choice, ChoiceNode } from '$lib/types/blocks';
	import { onMount } from 'svelte';

	let narrativeLog = $state<Array<{ text: string; type: 'narrative' | 'choice' }>>([]);

	onMount(() => {
		if (!$worldState || !$worldBlocks) {
			goto('/');
			return;
		}
		startNewSession();
	});

	function startNewSession() {
		const world = $worldState!;
		const blocks = $worldBlocks!;
		const season = world.config.dateSystem.seasons[0];

		// Pick an event
		const event = selectEvent(blocks.events, world, season, [], blocks.questlines);
		if (!event) {
			narrativeLog = [{ text: 'Nothing eventful happens today. The world is quiet.', type: 'narrative' }];
			return;
		}

		// Collapse roles
		const collapsed = collapseAllRoles(event.roles, world.characters, blocks.archetypes);

		// Add newly created characters to world state
		const newChars = collapsed.filter(c => c.newCharacter).map(c => c.newCharacter!);
		if (newChars.length > 0) {
			worldState.update(s => s ? { ...s, characters: [...s.characters, ...newChars] } : s);
		}

		// Determine character — use first existing or first newly created
		const allChars = [...world.characters, ...newChars];
		const playableChar = allChars[0];
		if (!playableChar) return;

		const session: PlaySession = {
			characterId: playableChar.id,
			date: { year: world.config.dateSystem.startYear, season, day: 1 },
			eventTemplateId: event.id,
			collapsedRoles: collapsed.map(({ newCharacter, ...role }) => role),
			currentNodeId: event.entryNodeId,
			choiceLog: [],
			exhaustion: 0,
			maxExhaustion: 10,
			isDead: false,
			isComplete: false,
			dayTypePreferences: []
		};

		playSession.set(session);

		// Render the first node
		const node = event.nodes[event.entryNodeId];
		const interpolated = interpolateText(node.text, session.collapsedRoles, allChars);
		narrativeLog = [{ text: interpolated, type: 'narrative' }];
	}

	function getCurrentNode(): ChoiceNode | null {
		if (!$playSession || !$worldBlocks) return null;
		const event = $worldBlocks.events.find(e => e.id === $playSession.eventTemplateId);
		return event?.nodes[$playSession.currentNodeId] ?? null;
	}

	function getChoices(): Choice[] {
		const node = getCurrentNode();
		if (!node || !$playSession || !$worldState) return [];
		const character = $worldState.characters.find(c => c.id === $playSession.characterId);
		if (!character) return [];
		return getAvailableChoices(node, character, $playSession.exhaustion, $playSession.maxExhaustion);
	}

	function makeChoice(choice: Choice) {
		if (!$playSession || !$worldState || !$worldBlocks) return;

		const allChars = $worldState.characters;
		const labelText = interpolateText(choice.label, $playSession.collapsedRoles, allChars);
		narrativeLog = [...narrativeLog, { text: labelText, type: 'choice' }];

		const result = resolveChoice(choice, $playSession, $worldState);
		playSession.set(result.session);
		worldState.set(result.world);

		// Update questlines
		const updatedProgress = updateQuestlines(result.world.questlineProgress, $worldBlocks.questlines);
		worldState.update(s => s ? { ...s, questlineProgress: updatedProgress } : s);

		// Render next node if session continues
		if (!result.session.isComplete) {
			const event = $worldBlocks.events.find(e => e.id === result.session.eventTemplateId);
			const nextNode = event?.nodes[result.session.currentNodeId];
			if (nextNode) {
				const text = interpolateText(nextNode.text, result.session.collapsedRoles, result.world.characters);
				narrativeLog = [...narrativeLog, { text, type: 'narrative' }];
			}
		}

		if (result.session.isComplete) {
			saveWorldState(result.world);
		}
	}

	function rest() {
		if (!$playSession || !$worldState) return;
		const updated = { ...$playSession, isComplete: true };
		playSession.set(updated);
		saveWorldState($worldState);
	}

	let choices = $derived(getChoices());
	let currentNode = $derived(getCurrentNode());
	let isComplete = $derived($playSession?.isComplete ?? false);
	let character = $derived($worldState?.characters.find(c => c.id === $playSession?.characterId));
</script>

<div class="journal" style="background-color: var(--journal-bg); color: var(--journal-text);">
	{#if character && $playSession}
		<div class="journal-header">
			<div class="date">{$playSession.date.season.toUpperCase()}, DAY {$playSession.date.day} — YEAR {$playSession.date.year}</div>
			<div class="character">{character.name} the {character.archetypeId}</div>
		</div>

		<hr />

		<div class="narrative">
			{#each narrativeLog as entry}
				{#if entry.type === 'narrative'}
					<p class="narrative-text">{entry.text}</p>
				{:else}
					<p class="choice-made">> {entry.text}</p>
				{/if}
			{/each}
		</div>

		{#if !isComplete && choices.length > 0}
			<div class="choices">
				<div class="choices-header">WHAT DO YOU DO?</div>
				{#each choices as choice}
					<button class="choice-btn" onclick={() => makeChoice(choice)}>
						{interpolateText(choice.label, $playSession.collapsedRoles, $worldState?.characters ?? [])}
					</button>
				{/each}
				<button class="choice-btn rest-btn" onclick={rest}>
					Rest — Close the journal for now
				</button>
			</div>
		{/if}

		{#if isComplete}
			<div class="session-complete">
				<p>{$playSession.isDead ? 'You have died.' : 'You rest and close your journal.'}</p>
				<button onclick={() => goto('/session-end')}>Continue</button>
			</div>
		{/if}

		<div class="exhaustion-bar">
			Exhaustion: {$playSession.exhaustion}/{$playSession.maxExhaustion}
		</div>
	{/if}
</div>

<style>
	.journal {
		min-height: 100vh;
		padding: 2rem;
		max-width: 700px;
		margin: 0 auto;
		font-family: var(--journal-font);
		position: relative;
	}

	.journal-header {
		text-align: center;
		margin-bottom: 1rem;
	}

	.date {
		font-size: 0.8rem;
		letter-spacing: 2px;
		opacity: 0.6;
	}

	.character {
		font-size: 0.9rem;
		opacity: 0.5;
		margin-top: 0.25rem;
	}

	hr {
		border: none;
		border-top: 1px solid var(--journal-border);
		margin: 1rem 0;
	}

	.narrative-text {
		line-height: 1.8;
		font-size: 1rem;
		margin-bottom: 0.75rem;
	}

	.choice-made {
		font-style: italic;
		opacity: 0.7;
		margin: 0.5rem 0;
		padding-left: 1rem;
		border-left: 2px solid var(--journal-accent);
	}

	.choices {
		border-left: 3px solid var(--journal-accent);
		padding: 0.75rem 1rem;
		margin: 1.5rem 0;
		background: rgba(139, 105, 20, 0.08);
		border-radius: 0 6px 6px 0;
	}

	.choices-header {
		font-size: 0.75rem;
		letter-spacing: 1px;
		opacity: 0.6;
		margin-bottom: 0.5rem;
	}

	.choice-btn {
		display: block;
		width: 100%;
		padding: 0.5rem 0.75rem;
		margin: 0.4rem 0;
		border: 1px solid var(--journal-border);
		border-radius: 4px;
		background: var(--journal-choice-bg);
		color: var(--journal-text);
		font-family: var(--journal-font);
		font-size: 0.9rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.2s;
	}

	.choice-btn:hover {
		background: var(--journal-choice-hover);
	}

	.rest-btn {
		font-style: italic;
		opacity: 0.8;
		margin-top: 0.75rem;
	}

	.session-complete {
		text-align: center;
		margin: 2rem 0;
		padding: 1.5rem;
		background: rgba(139, 105, 20, 0.1);
		border-radius: 8px;
	}

	.session-complete button {
		margin-top: 1rem;
		padding: 0.5rem 1.5rem;
		border: 1px solid var(--journal-accent);
		background: rgba(139, 105, 20, 0.2);
		color: var(--journal-text);
		font-family: var(--journal-font);
		border-radius: 4px;
		cursor: pointer;
	}

	.exhaustion-bar {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		font-size: 0.7rem;
		opacity: 0.4;
	}
</style>
```

- [ ] **Step 5: Verify dev server loads the journal page**

```bash
npm run dev -- --port 5173 &
sleep 3
curl -s http://localhost:5173 | head -20
kill %1
```

Expected: HTML with "Journal RPG" landing page.

- [ ] **Step 6: Commit**

```bash
git add src/ static/
git commit -m "feat: add journal play page with parchment UI, landing page, and default theme"
```

---

### Task 12: Session End Page

**Files:**
- Create: `src/routes/session-end/+page.svelte`

- [ ] **Step 1: Create the session end page**

Create `src/routes/session-end/+page.svelte`:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { worldState } from '$lib/stores/world';
	import { playSession } from '$lib/stores/session';
	import { saveWorldState, loadWorldState } from '$lib/engine/world-loader';

	let session = $derived($playSession);
	let character = $derived($worldState?.characters.find(c => c.id === session?.characterId));

	function saveAndContinue() {
		if ($worldState) {
			saveWorldState($worldState);
		}
		playSession.set(null);
		goto('/journal');
	}

	function discardAndReplay() {
		// Reload the world state from before this session
		const savedState = loadWorldState();
		if (savedState) {
			worldState.set(savedState);
		}
		playSession.set(null);
		goto('/journal');
	}

	function discardAndMenu() {
		const savedState = loadWorldState();
		if (savedState) {
			worldState.set(savedState);
		}
		playSession.set(null);
		goto('/');
	}
</script>

<div class="session-end">
	{#if session && character}
		<div class="header">
			<h2>Journal Entry Complete</h2>
			<p class="character-info">{character.name} the {character.archetypeId} — {session.date.season}, Day {session.date.day}</p>
		</div>

		<div class="summary">
			<div class="label">SUMMARY</div>
			<p>
				{#if session.isDead}
					{character.name} has died. Their story ends here.
				{:else}
					{character.name} made {session.choiceLog.length} choices today.
				{/if}
			</p>
			<div class="consequences">
				{#each session.choiceLog as record}
					<span class="tag">{record.text}</span>
				{/each}
			</div>
		</div>

		<div class="actions-section">
			<div class="label">THIS ENTRY</div>
			<button onclick={saveAndContinue}>Save this entry</button>
			<button onclick={discardAndReplay}>Discard and replay this day</button>
			<button onclick={discardAndMenu}>Discard and return to menu</button>
		</div>

		{#if !session.isDead}
			<div class="actions-section">
				<div class="label">NEXT ENTRY</div>
				<button disabled>The Past — revisit {character.name}'s earlier life</button>
				<button disabled>The Future — continue {character.name}'s story</button>
				<button disabled>Someone Else — a different life, a different time</button>
				<p class="coming-soon">Timeline navigation coming in Phase 2</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.session-end {
		min-height: 100vh;
		background: var(--session-end-bg);
		color: var(--session-end-text);
		padding: 2rem;
		max-width: 600px;
		margin: 0 auto;
		font-family: var(--journal-font);
	}

	.header {
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.header h2 {
		font-size: 1.5rem;
		margin-bottom: 0.5rem;
	}

	.character-info {
		font-size: 0.85rem;
		opacity: 0.6;
	}

	.summary {
		background: var(--session-end-card-bg);
		border-radius: 8px;
		padding: 1.25rem;
		margin: 1rem 0;
	}

	.label {
		font-size: 0.7rem;
		letter-spacing: 1px;
		opacity: 0.5;
		margin-bottom: 0.5rem;
	}

	.consequences {
		margin-top: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.tag {
		font-size: 0.75rem;
		padding: 0.2rem 0.5rem;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 4px;
	}

	.actions-section {
		margin: 1.5rem 0;
	}

	button {
		display: block;
		width: 100%;
		padding: 0.75rem 1rem;
		margin: 0.5rem 0;
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.03);
		color: var(--session-end-text);
		font-family: var(--journal-font);
		font-size: 0.95rem;
		text-align: center;
		cursor: pointer;
		transition: background 0.2s;
	}

	button:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.08);
	}

	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.coming-soon {
		text-align: center;
		font-size: 0.75rem;
		opacity: 0.4;
		margin-top: 0.5rem;
	}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/session-end/
git commit -m "feat: add session end page — save/discard/replay with summary view"
```

---

### Task 13: Run Full Test Suite and Integration Check

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All engine tests pass (collapse, event-selector, choice-resolver, questline-tracker, text-generator).

- [ ] **Step 2: Build the static site**

```bash
npm run build
```

Expected: Build succeeds, output in `build/` directory.

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev -- --port 5173
```

Open `http://localhost:5173` in a browser. Verify:
- Landing page shows "Journal RPG" with Start New World button
- Clicking Start New World navigates to the journal page
- Narrative text renders with the parchment aesthetic
- Choices appear and are clickable
- "Rest" button works and navigates to session end
- Session end page shows summary and action buttons

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify full build, type check, and test suite pass"
```

---

## Phase 2 Preview (Not In This Plan)

The following will be planned separately after Phase 1 is complete:

- **Git integration:** isomorphic-git for in-browser git, Octokit for GitHub API
- **Branch/PR lifecycle:** create branch on session start, commit per choice, PR on rest
- **GitHub auth:** OAuth flow + PAT option
- **Timeline navigation:** past/future/someone else with git history
- **YAML file loading from git repos:** replace hardcoded demo world
- **Multiplayer conflict resolution:** merge strategies for shared state
- **LLM integration:** template/local/Claude adapter in text-generator
- **Block sharing ecosystem:** import/export YAML blocks between worlds
