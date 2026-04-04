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

	// Local reactive state
	let narrative = $state<Array<{ text: string; choiceLabel?: string }>>([]);
	let currentNode = $state<ChoiceNode | null>(null);
	let availableChoices = $state<Choice[]>([]);
	let isLoading = $state(true);
	let errorMessage = $state('');

	// Derived from stores
	let session = $derived($playSession);
	let state = $derived($worldState);
	let blocks = $derived($worldBlocks);

	let exhaustionPercent = $derived(
		session ? Math.round((session.exhaustion / session.maxExhaustion) * 100) : 0
	);

	let currentCharacter = $derived(
		session && state ? state.characters.find(c => c.id === session!.characterId) ?? null : null
	);

	function getCurrentNode(): ChoiceNode | null {
		if (!session || !blocks) return null;
		const event = blocks.events.find(e => e.id === session!.eventTemplateId);
		if (!event) return null;
		return event.nodes[session.currentNodeId] ?? null;
	}

	function refreshChoices() {
		if (!session || !currentCharacter) {
			availableChoices = [];
			return;
		}
		const node = getCurrentNode();
		if (!node) {
			availableChoices = [];
			return;
		}
		currentNode = node;
		availableChoices = getAvailableChoices(node, currentCharacter, session.exhaustion, session.maxExhaustion);
	}

	function getInterpolatedText(text: string): string {
		if (!session || !state) return text;
		return interpolateText(text, session.collapsedRoles, state.characters);
	}

	onMount(() => {
		const savedState = $worldState;
		const savedBlocks = $worldBlocks;

		if (!savedState || !savedBlocks) {
			goto('/');
			return;
		}

		// Start a new session
		const currentSeason = savedState.config.dateSystem.seasons[0];
		const event = selectEvent(
			savedBlocks.events,
			savedState,
			currentSeason,
			[],
			savedBlocks.questlines
		);

		if (!event) {
			errorMessage = 'No events available for this world state.';
			isLoading = false;
			return;
		}

		// Collapse roles
		const collapseResults = collapseAllRoles(
			event.roles,
			savedState.characters,
			savedBlocks.archetypes
		);

		// Add any new characters to world state
		const newState = { ...savedState, characters: [...savedState.characters] };
		for (const result of collapseResults) {
			if (result.wasNewlyCreated && result.newCharacter) {
				newState.characters.push(result.newCharacter);
			}
		}

		// Pick a character to play (first collapsed role or first living character)
		let characterId = collapseResults[0]?.characterId ?? '';
		if (!characterId && newState.characters.length > 0) {
			characterId = newState.characters.find(c => c.alive)?.id ?? '';
		}

		const collapsedRoles = collapseResults.map(r => ({
			roleId: r.roleId,
			characterId: r.characterId,
			characterName: r.characterName,
			wasNewlyCreated: r.wasNewlyCreated
		}));

		const newSession: PlaySession = {
			characterId,
			date: { year: savedState.config.dateSystem.startYear, season: currentSeason, day: 1 },
			eventTemplateId: event.id,
			collapsedRoles,
			currentNodeId: event.entryNodeId,
			choiceLog: [],
			exhaustion: 0,
			maxExhaustion: 10,
			isDead: false,
			isComplete: false,
			dayTypePreferences: []
		};

		worldState.set(newState);
		playSession.set(newSession);

		// Set initial narrative text
		const entryNode = event.nodes[event.entryNodeId];
		if (entryNode) {
			const interpolated = interpolateText(entryNode.text, collapsedRoles, newState.characters);
			narrative = [{ text: interpolated }];
			currentNode = entryNode;
			const character = newState.characters.find(c => c.id === characterId);
			if (character) {
				availableChoices = getAvailableChoices(entryNode, character, 0, 10);
			}
		}

		isLoading = false;
	});

	function handleChoice(choice: Choice) {
		if (!session || !state || !blocks) return;

		const { session: newSession, world: newWorld } = resolveChoice(choice, session, state);

		// Interpolate choice label for narrative log
		const choiceLabel = getInterpolatedText(choice.label);

		// Get next node text if available
		let nextText = '';
		if (choice.nextNodeId && blocks) {
			const event = blocks.events.find(e => e.id === session!.eventTemplateId);
			const nextNode = event?.nodes[choice.nextNodeId];
			if (nextNode) {
				nextText = interpolateText(nextNode.text, newSession.collapsedRoles, newWorld.characters);
			}
		}

		// Update narrative log
		narrative = [
			...narrative,
			{ text: choiceLabel, choiceLabel: choiceLabel },
			...(nextText ? [{ text: nextText }] : [])
		];

		// Update questlines
		const updatedProgress = updateQuestlines(newWorld.questlineProgress, blocks.questlines);
		const updatedWorld = { ...newWorld, questlineProgress: updatedProgress };

		worldState.set(updatedWorld);
		playSession.set(newSession);
		saveWorldState(updatedWorld);

		if (newSession.isComplete) {
			goto('/session-end');
			return;
		}

		// Refresh choices for new node
		const event = blocks.events.find(e => e.id === newSession.eventTemplateId);
		if (event && choice.nextNodeId) {
			const nextNode = event.nodes[choice.nextNodeId];
			if (nextNode) {
				currentNode = nextNode;
				const character = updatedWorld.characters.find(c => c.id === newSession.characterId);
				if (character) {
					availableChoices = getAvailableChoices(nextNode, character, newSession.exhaustion, newSession.maxExhaustion);
				} else {
					availableChoices = [];
				}
			}
		} else {
			availableChoices = [];
		}
	}

	function handleRest() {
		if (!session) return;
		playSession.update(s => s ? { ...s, isComplete: true } : s);
		goto('/session-end');
	}
</script>

{#if isLoading}
	<div class="loading-screen">
		<p>Opening the journal...</p>
	</div>
{:else if errorMessage}
	<div class="error-screen">
		<p>{errorMessage}</p>
		<button onclick={() => goto('/')}>Return Home</button>
	</div>
{:else}
<div class="journal-page">
	<!-- Header -->
	<header class="journal-header">
		<div class="header-left">
			<a href="/" class="back-link">← Home</a>
		</div>
		<div class="header-center">
			{#if session && state}
				<span class="date-display">
					{state.config.dateSystem.seasons[0].charAt(0).toUpperCase() + state.config.dateSystem.seasons[0].slice(1)},
					Year {session.date.year}
				</span>
			{/if}
		</div>
		<div class="header-right">
			{#if session}
				<div class="exhaustion-meter" title="Exhaustion: {session.exhaustion}/{session.maxExhaustion}">
					<span class="exhaustion-label">Fatigue</span>
					<div class="exhaustion-bar">
						<div
							class="exhaustion-fill"
							style="width: {exhaustionPercent}%"
							class:exhaustion-warning={exhaustionPercent >= 60}
							class:exhaustion-danger={exhaustionPercent >= 85}
						></div>
					</div>
					<span class="exhaustion-value">{session.exhaustion}/{session.maxExhaustion}</span>
				</div>
			{/if}
		</div>
	</header>

	<!-- Journal content -->
	<main class="journal-main">
		<div class="parchment">
			{#if session && state && blocks}
				<!-- Character info -->
				{#if currentCharacter}
					<div class="character-banner">
						<span class="character-name">{currentCharacter.name}</span>
						<span class="character-role">{currentCharacter.archetypeId}</span>
					</div>
				{/if}

				<!-- Event name -->
				{#if session}
					{@const event = blocks.events.find(e => e.id === session!.eventTemplateId)}
					{#if event}
						<h2 class="event-title">{event.name}</h2>
					{/if}
				{/if}

				<!-- Narrative log -->
				<div class="narrative">
					{#each narrative as entry, i}
						{#if entry.choiceLabel}
							<p class="narrative-choice">› {entry.text}</p>
						{:else}
							<p class="narrative-text" class:narrative-entry={i === 0} class:narrative-continuation={i > 0}>
								{entry.text}
							</p>
						{/if}
					{/each}
				</div>

				<!-- Choices -->
				{#if !session.isComplete}
					<div class="choices-section">
						<p class="choices-prompt">What do you do?</p>
						<div class="choices-list">
							{#each availableChoices as choice}
								<button
									class="choice-btn"
									onclick={() => handleChoice(choice)}
								>
									<span class="choice-label">{getInterpolatedText(choice.label)}</span>
									{#if choice.exhaustionCost > 0}
										<span class="choice-cost" title="Exhaustion cost">+{choice.exhaustionCost} fatigue</span>
									{/if}
								</button>
							{/each}

							<!-- Rest is always available -->
							<button class="choice-btn choice-rest" onclick={handleRest}>
								<span class="choice-label">Rest and end the day</span>
								<span class="choice-cost">End session</span>
							</button>
						</div>
					</div>
				{:else}
					<div class="session-complete">
						<p>The day draws to a close...</p>
						<button class="btn-end" onclick={() => goto('/session-end')}>
							See how the day went
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</main>
</div>
{/if}

<style>
	.loading-screen,
	.error-screen {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: var(--journal-bg);
		color: var(--journal-text);
		font-family: var(--journal-font);
		gap: 1rem;
	}

	.error-screen button {
		padding: 0.5rem 1.5rem;
		background: var(--journal-accent);
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-family: var(--journal-font);
	}

	.journal-page {
		min-height: 100vh;
		background-color: var(--journal-bg);
		color: var(--journal-text);
		font-family: var(--journal-font);
		display: flex;
		flex-direction: column;
	}

	/* Header */
	.journal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1.5rem;
		background: rgba(58, 42, 26, 0.08);
		border-bottom: 1px solid var(--journal-border);
		gap: 1rem;
	}

	.header-left,
	.header-right {
		flex: 1;
	}

	.header-right {
		display: flex;
		justify-content: flex-end;
	}

	.header-center {
		text-align: center;
	}

	.back-link {
		color: var(--journal-accent);
		text-decoration: none;
		font-size: 0.9rem;
		opacity: 0.8;
	}

	.back-link:hover {
		opacity: 1;
	}

	.date-display {
		font-size: 0.9rem;
		color: var(--journal-muted);
		letter-spacing: 0.05em;
	}

	/* Exhaustion meter */
	.exhaustion-meter {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.exhaustion-label {
		color: var(--journal-muted);
		white-space: nowrap;
	}

	.exhaustion-bar {
		width: 80px;
		height: 6px;
		background: rgba(58, 42, 26, 0.15);
		border-radius: 3px;
		overflow: hidden;
		border: 1px solid var(--journal-border);
	}

	.exhaustion-fill {
		height: 100%;
		background: var(--journal-accent);
		border-radius: 3px;
		transition: width 0.3s ease, background-color 0.3s ease;
	}

	.exhaustion-fill.exhaustion-warning {
		background: #c07820;
	}

	.exhaustion-fill.exhaustion-danger {
		background: #a03010;
	}

	.exhaustion-value {
		color: var(--journal-muted);
		white-space: nowrap;
		font-size: 0.75rem;
	}

	/* Main journal area */
	.journal-main {
		flex: 1;
		display: flex;
		justify-content: center;
		padding: 2rem 1rem;
	}

	.parchment {
		width: 100%;
		max-width: 680px;
		background: rgba(255, 255, 255, 0.25);
		border: 1px solid var(--journal-border);
		border-radius: 4px;
		padding: 2.5rem 3rem;
		box-shadow:
			inset 0 0 30px rgba(196, 168, 122, 0.15),
			0 2px 12px rgba(58, 42, 26, 0.12);
	}

	/* Character banner */
	.character-banner {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--journal-border);
	}

	.character-name {
		font-size: 1.1rem;
		font-weight: bold;
		color: var(--journal-accent);
	}

	.character-role {
		font-size: 0.85rem;
		color: var(--journal-muted);
		font-style: italic;
		text-transform: capitalize;
	}

	/* Event title */
	.event-title {
		font-size: 1.4rem;
		color: var(--journal-text);
		margin-bottom: 1.5rem;
		font-style: italic;
		opacity: 0.85;
	}

	/* Narrative */
	.narrative {
		margin-bottom: 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.narrative-text {
		font-size: 1rem;
		line-height: 1.8;
		color: var(--journal-text);
	}

	.narrative-entry {
		font-size: 1.05rem;
	}

	.narrative-continuation {
		padding-top: 0.25rem;
		border-top: 1px dashed rgba(196, 168, 122, 0.4);
	}

	.narrative-choice {
		font-size: 0.9rem;
		color: var(--journal-accent);
		font-style: italic;
		padding-left: 1rem;
		border-left: 2px solid var(--journal-border);
	}

	/* Choices section */
	.choices-section {
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--journal-border);
	}

	.choices-prompt {
		font-size: 0.85rem;
		color: var(--journal-muted);
		margin-bottom: 1rem;
		font-style: italic;
		letter-spacing: 0.04em;
	}

	.choices-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.choice-btn {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.75rem 1rem;
		background: var(--journal-choice-bg);
		border: 1px solid var(--journal-border);
		border-radius: 4px;
		cursor: pointer;
		font-family: var(--journal-font);
		font-size: 0.95rem;
		color: var(--journal-text);
		text-align: left;
		transition: background 0.15s, border-color 0.15s, transform 0.1s;
		gap: 1rem;
	}

	.choice-btn:hover {
		background: var(--journal-choice-hover);
		border-color: var(--journal-accent);
		transform: translateX(2px);
	}

	.choice-btn:active {
		transform: translateX(0);
	}

	.choice-rest {
		margin-top: 0.4rem;
		opacity: 0.7;
		border-style: dashed;
	}

	.choice-rest:hover {
		opacity: 1;
	}

	.choice-label {
		flex: 1;
	}

	.choice-cost {
		font-size: 0.75rem;
		color: var(--journal-muted);
		white-space: nowrap;
	}

	/* Session complete */
	.session-complete {
		text-align: center;
		padding: 2rem 0 1rem;
		color: var(--journal-muted);
		font-style: italic;
	}

	.btn-end {
		margin-top: 1rem;
		padding: 0.65rem 1.75rem;
		background: var(--journal-accent);
		color: #fff8ee;
		border: none;
		border-radius: 4px;
		font-family: var(--journal-font);
		font-size: 0.95rem;
		cursor: pointer;
	}

	.btn-end:hover {
		opacity: 0.9;
	}
</style>
