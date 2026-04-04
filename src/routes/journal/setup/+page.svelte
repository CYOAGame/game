<script lang="ts">
	import { goto } from '$app/navigation';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { playSession } from '$lib/stores/session';
	import { collapseAllRoles } from '$lib/engine/collapse';
	import { selectEvent } from '$lib/engine/event-selector';
	import type { Archetype } from '$lib/types/blocks';

	const DAY_TYPE_OPTIONS = [
		{ id: 'action', label: 'Action' },
		{ id: 'social', label: 'Social' },
		{ id: 'crafting', label: 'Crafting' },
		{ id: 'romance', label: 'Romance' },
		{ id: 'exploration', label: 'Exploration' },
		{ id: 'combat', label: 'Combat' }
	];

	let blocks = $derived($worldBlocks);
	let state = $derived($worldState);

	let archetypes = $derived(blocks?.archetypes ?? []);
	let selectedArchetypeId = $state<string>('');
	let selectedDayTypes = $state<string[]>([]);

	let selectedArchetype = $derived(
		archetypes.find((a: Archetype) => a.id === selectedArchetypeId) ?? null
	);

	function toggleDayType(id: string) {
		if (selectedDayTypes.includes(id)) {
			selectedDayTypes = selectedDayTypes.filter(t => t !== id);
		} else {
			selectedDayTypes = [...selectedDayTypes, id];
		}
	}

	function traitLabel(key: string): string {
		return key.charAt(0).toUpperCase() + key.slice(1);
	}

	function beginDay() {
		if (!blocks || !state || !selectedArchetype) return;

		// Create a character from the chosen archetype
		const archetype = selectedArchetype;
		const name = archetype.namingPatterns[Math.floor(Math.random() * archetype.namingPatterns.length)];
		const id = `${name.toLowerCase()}_${archetype.id}_${Date.now()}`;

		const traits: Record<string, number> = {};
		for (const [trait, range] of Object.entries(archetype.traits)) {
			traits[trait] = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
		}

		const character = {
			id,
			name,
			archetypeId: archetype.id,
			traits,
			skills: [...archetype.skills],
			locationId: '',
			factions: {} as Record<string, number>,
			relationships: {} as Record<string, number>,
			birthDate: { year: 800, season: 'spring', day: 1 },
			deathDate: null,
			alive: true
		};

		// Add the character to world state
		const newState = { ...state, characters: [...state.characters, character] };
		worldState.set(newState);

		// Select an event using day type preferences
		const currentSeason = newState.config.dateSystem.seasons[0];
		const event = selectEvent(
			blocks.events,
			newState,
			currentSeason,
			selectedDayTypes,
			blocks.questlines
		);

		if (!event) {
			// Fallback: just go to journal and let it handle it
			goto('/journal');
			return;
		}

		// Collapse roles
		const collapseResults = collapseAllRoles(
			event.roles,
			newState.characters,
			blocks.archetypes
		);

		// Add any newly created characters
		for (const result of collapseResults) {
			if (result.wasNewlyCreated && result.newCharacter) {
				newState.characters.push(result.newCharacter);
			}
		}

		const collapsedRoles = collapseResults.map(r => ({
			roleId: r.roleId,
			characterId: r.characterId,
			characterName: r.characterName,
			wasNewlyCreated: r.wasNewlyCreated
		}));

		const session = {
			characterId: character.id,
			date: { year: newState.config.dateSystem.startYear, season: currentSeason, day: 1 },
			eventTemplateId: event.id,
			collapsedRoles,
			currentNodeId: event.entryNodeId,
			choiceLog: [],
			exhaustion: 0,
			maxExhaustion: 10,
			isDead: false,
			isComplete: false,
			dayTypePreferences: selectedDayTypes
		};

		worldState.set(newState);
		playSession.set(session);
		goto('/journal');
	}
</script>

<div class="setup-page">
	<div class="setup-inner">
		<h1 class="setup-title">Begin a New Day</h1>
		<p class="setup-subtitle">Choose who you are and what kind of day awaits.</p>

		<!-- Archetype selection -->
		<section class="section">
			<h2 class="section-label">Choose Your Role</h2>
			<div class="archetype-grid">
				{#each archetypes as archetype}
					<button
						class="archetype-card"
						class:selected={selectedArchetypeId === archetype.id}
						onclick={() => selectedArchetypeId = archetype.id}
					>
						<span class="archetype-name">{archetype.name}</span>
						<div class="archetype-traits">
							{#each Object.entries(archetype.traits) as [key, range]}
								<span class="trait">{traitLabel(key)}: {range.min}-{range.max}</span>
							{/each}
						</div>
						<div class="archetype-skills">
							{#each archetype.skills as skill}
								<span class="skill-tag">{skill}</span>
							{/each}
						</div>
					</button>
				{/each}
			</div>
		</section>

		<!-- Day type preferences -->
		<section class="section">
			<h2 class="section-label">What Kind of Day?</h2>
			<p class="section-hint">Select as many as you like, or none for a surprise.</p>
			<div class="day-type-grid">
				{#each DAY_TYPE_OPTIONS as option}
					<button
						class="day-type-btn"
						class:active={selectedDayTypes.includes(option.id)}
						onclick={() => toggleDayType(option.id)}
					>
						{option.label}
					</button>
				{/each}
			</div>
		</section>

		<!-- Begin button -->
		<div class="begin-section">
			<button
				class="begin-btn"
				disabled={!selectedArchetypeId}
				onclick={beginDay}
			>
				Begin the Day
			</button>
			{#if !selectedArchetypeId}
				<p class="begin-hint">Choose a role to begin.</p>
			{/if}
		</div>

		<a href="/" class="back-link">&larr; Back to menu</a>
	</div>
</div>

<style>
	.setup-page {
		min-height: 100vh;
		background-color: var(--journal-bg);
		color: var(--journal-text);
		font-family: var(--journal-font);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
	}

	.setup-inner {
		max-width: 640px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.setup-title {
		font-size: 2.5rem;
		color: var(--journal-accent);
		text-align: center;
		letter-spacing: 0.04em;
	}

	.setup-subtitle {
		text-align: center;
		font-style: italic;
		opacity: 0.7;
		margin-top: -1rem;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section-label {
		font-size: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.6;
		font-weight: normal;
	}

	.section-hint {
		font-size: 0.85rem;
		opacity: 0.5;
		font-style: italic;
		margin-top: -0.5rem;
	}

	/* Archetype cards */
	.archetype-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.archetype-card {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 1rem 1.25rem;
		background: var(--journal-choice-bg);
		border: 2px solid var(--journal-border);
		border-radius: 6px;
		cursor: pointer;
		font-family: var(--journal-font);
		color: var(--journal-text);
		text-align: left;
		transition: border-color 0.15s, background 0.15s, transform 0.1s;
	}

	.archetype-card:hover {
		background: var(--journal-choice-hover);
		transform: translateX(2px);
	}

	.archetype-card.selected {
		border-color: var(--journal-accent);
		background: rgba(139, 105, 20, 0.12);
	}

	.archetype-name {
		font-size: 1.15rem;
		font-weight: bold;
		color: var(--journal-accent);
	}

	.archetype-traits {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.trait {
		font-size: 0.8rem;
		opacity: 0.65;
	}

	.archetype-skills {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.1rem;
	}

	.skill-tag {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
		background: rgba(139, 105, 20, 0.1);
		border: 1px solid var(--journal-border);
		border-radius: 12px;
		text-transform: capitalize;
	}

	/* Day type toggles */
	.day-type-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.day-type-btn {
		padding: 0.45rem 1rem;
		border: 1px solid var(--journal-border);
		border-radius: 20px;
		background: var(--journal-choice-bg);
		color: var(--journal-text);
		font-family: var(--journal-font);
		font-size: 0.9rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}

	.day-type-btn:hover {
		background: var(--journal-choice-hover);
	}

	.day-type-btn.active {
		background: rgba(139, 105, 20, 0.18);
		border-color: var(--journal-accent);
		color: var(--journal-accent);
		font-weight: bold;
	}

	/* Begin section */
	.begin-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.begin-btn {
		padding: 0.85rem 2.5rem;
		background: var(--journal-accent);
		color: #fff8ee;
		border: none;
		border-radius: 4px;
		font-family: var(--journal-font);
		font-size: 1.1rem;
		font-weight: bold;
		cursor: pointer;
		letter-spacing: 0.04em;
		transition: opacity 0.15s, transform 0.1s;
	}

	.begin-btn:hover:not(:disabled) {
		opacity: 0.9;
		transform: translateY(-1px);
	}

	.begin-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.begin-hint {
		font-size: 0.8rem;
		opacity: 0.45;
		font-style: italic;
	}

	.back-link {
		text-align: center;
		color: var(--journal-accent);
		text-decoration: none;
		font-size: 0.85rem;
		opacity: 0.6;
		transition: opacity 0.15s;
	}

	.back-link:hover {
		opacity: 1;
	}
</style>
