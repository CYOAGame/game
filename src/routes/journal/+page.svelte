<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { playSession } from '$lib/stores/session';
	import { resolveChoice, getAvailableChoices } from '$lib/engine/choice-resolver';
	import { collapseAllRoles } from '$lib/engine/collapse';
	import { selectEvent } from '$lib/engine/event-selector';
	import { interpolateText } from '$lib/engine/text-generator';
	import { updateQuestlines } from '$lib/engine/questline-tracker';
	import { saveWorldState } from '$lib/engine/world-loader';
	import { enhanceText, type LLMContext } from '$lib/engine/llm-adapter';
	import { loadPlayerPrefs } from '$lib/stores/player';
	import type { PlaySession } from '$lib/types/session';
	import type { CollapsedRole } from '$lib/types/session';
	import type { Choice, ChoiceNode, EventTemplate } from '$lib/types/blocks';
	import { onMount } from 'svelte';

	const TRANSITION_BEATS = [
		'Time passes...',
		'Later that day...',
		'The hours slip by...',
		'As the sun moves across the sky...',
		'After a while...',
		'Some time later...'
	];

	// Local reactive state
	let narrative = $state<Array<{ text: string; choiceLabel?: string; separator?: boolean; eventTitle?: string }>>([]);
	let currentNode = $state<ChoiceNode | null>(null);
	let availableChoices = $state<Choice[]>([]);
	let isLoading = $state(true);
	let errorMessage = $state('');

	// Track the current event locally (since a day can span multiple events)
	let currentEventId = $state('');
	let currentCollapsedRoles = $state<CollapsedRole[]>([]);
	let playedEventIds = $state<string[]>([]);

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

	let currentEventName = $derived(() => {
		if (!blocks || !currentEventId) return '';
		const event = blocks.events.find(e => e.id === currentEventId);
		return event?.name ?? '';
	});

	function buildLLMContext(): LLMContext {
		return {
			characterName: currentCharacter?.name ?? '',
			characterArchetype: currentCharacter?.archetypeId ?? '',
			locationName: currentCharacter?.locationId,
			season: session?.date.season,
			timeContext: session?.timeContext ?? 'present',
			previousChoices: session?.choiceLog.map(c => c.text).slice(-3)
		};
	}

	function getNodeFromEvent(eventId: string, nodeId: string): ChoiceNode | null {
		if (!blocks) return null;
		const event = blocks.events.find(e => e.id === eventId);
		if (!event) return null;
		return event.nodes[nodeId] ?? null;
	}

	function getInterpolatedText(text: string): string {
		if (!session || !state) return text;
		return interpolateText(text, currentCollapsedRoles, state.characters);
	}

	function refreshChoicesForNode(node: ChoiceNode, currentSession: PlaySession, world: typeof state) {
		if (!world) return;
		currentNode = node;
		const character = world.characters.find(c => c.id === currentSession.characterId);
		if (character) {
			availableChoices = getAvailableChoices(node, character, currentSession.exhaustion, currentSession.maxExhaustion);
		} else {
			availableChoices = [];
		}
	}

	function startNextEvent(currentSession: PlaySession, currentWorld: NonNullable<typeof state>) {
		if (!blocks) return;

		// Pick a random transition beat
		const beat = TRANSITION_BEATS[Math.floor(Math.random() * TRANSITION_BEATS.length)];

		// Select a new event, preferring ones we haven't played
		const currentSeason = currentWorld.config.dateSystem.seasons[0];
		const preferences = currentSession.dayTypePreferences ?? [];

		// Only pick from events we haven't played this session — no repeats
		const candidateEvents = blocks.events.filter(e => !playedEventIds.includes(e.id));
		let event = selectEvent(
			candidateEvents,
			currentWorld,
			currentSeason,
			preferences,
			blocks.questlines
		);

		if (!event) {
			// No more fresh events available: end the day
			const updatedState = {
				...currentWorld,
				recentEventIds: [...(currentWorld.recentEventIds ?? []), ...playedEventIds].slice(-10)
			};
			worldState.set(updatedState);
			saveWorldState(updatedState);
			const endSession = { ...currentSession, isComplete: true };
			playSession.set(endSession);
			goto(`${base}/session-end`);
			return;
		}

		// Collapse roles for new event (exclude player character from NPC roles)
		const collapseResults = collapseAllRoles(
			event.roles,
			currentWorld.characters,
			blocks.archetypes,
			[currentSession.characterId]
		);

		const newWorld = { ...currentWorld, characters: [...currentWorld.characters] };
		for (const result of collapseResults) {
			if (result.wasNewlyCreated && result.newCharacter) {
				newWorld.characters.push(result.newCharacter);
			}
		}

		const newRoles = collapseResults.map(r => ({
			roleId: r.roleId,
			characterId: r.characterId,
			characterName: r.characterName,
			wasNewlyCreated: r.wasNewlyCreated
		}));

		// Update local tracking
		currentEventId = event.id;
		currentCollapsedRoles = newRoles;
		playedEventIds = [...playedEventIds, event.id];

		// Update session in store
		const updatedSession = {
			...currentSession,
			eventTemplateId: event.id,
			collapsedRoles: newRoles,
			currentNodeId: event.entryNodeId
		};
		worldState.set(newWorld);
		playSession.set(updatedSession);

		// Add transition and new event text to narrative
		const entryNode = event.nodes[event.entryNodeId];
		if (entryNode) {
			const interpolated = interpolateText(entryNode.text, newRoles, newWorld.characters);
			narrative = [
				...narrative,
				{ text: beat, separator: true },
				{ text: event.name, eventTitle: event.name },
				{ text: interpolated }
			];
			refreshChoicesForNode(entryNode, updatedSession, newWorld);

			// Optionally enhance narrative text with LLM in background
			const prefs = loadPlayerPrefs();
			if (prefs.llmSetting !== 'none') {
				const narrativeIndex = narrative.length - 1;
				enhanceText(interpolated, buildLLMContext(), prefs).then(enhanced => {
					if (enhanced !== interpolated) {
						narrative = narrative.map((entry, i) =>
							i === narrativeIndex ? { ...entry, text: enhanced } : entry
						);
					}
				});
			}
		}
	}

	onMount(() => {
		const savedState = $worldState;
		const savedBlocks = $worldBlocks;

		if (!savedState || !savedBlocks) {
			goto(`${base}/`);
			return;
		}

		// Check if a session was already set up by the setup page
		const existingSession = $playSession;
		if (existingSession && !existingSession.isComplete) {
			// Session was pre-created by setup page — use it
			currentEventId = existingSession.eventTemplateId;
			currentCollapsedRoles = existingSession.collapsedRoles;
			playedEventIds = [existingSession.eventTemplateId];

			const event = savedBlocks.events.find(e => e.id === existingSession.eventTemplateId);
			if (event) {
				const entryNode = event.nodes[existingSession.currentNodeId];
				if (entryNode) {
					const interpolated = interpolateText(entryNode.text, existingSession.collapsedRoles, savedState.characters);
					narrative = [{ text: interpolated }];
					refreshChoicesForNode(entryNode, existingSession, savedState);

					// Optionally enhance narrative text with LLM in background
					const prefs = loadPlayerPrefs();
					if (prefs.llmSetting !== 'none') {
						enhanceText(interpolated, buildLLMContext(), prefs).then(enhanced => {
							if (enhanced !== interpolated) {
								narrative = narrative.map((entry, i) =>
									i === 0 ? { ...entry, text: enhanced } : entry
								);
							}
						});
					}
				}
			}
			isLoading = false;
			return;
		}

		// Fallback: start a new session if none exists (legacy path)
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

		const collapseResults = collapseAllRoles(
			event.roles,
			savedState.characters,
			savedBlocks.archetypes,
			[] // legacy path — no player character to exclude yet
		);

		const newState = { ...savedState, characters: [...savedState.characters] };
		for (const result of collapseResults) {
			if (result.wasNewlyCreated && result.newCharacter) {
				newState.characters.push(result.newCharacter);
			}
		}

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
			dayTypePreferences: [],
			timeContext: 'present'
		};

		currentEventId = event.id;
		currentCollapsedRoles = collapsedRoles;
		playedEventIds = [event.id];

		worldState.set(newState);
		playSession.set(newSession);

		const entryNode = event.nodes[event.entryNodeId];
		if (entryNode) {
			const interpolated = interpolateText(entryNode.text, collapsedRoles, newState.characters);
			narrative = [{ text: interpolated }];
			refreshChoicesForNode(entryNode, newSession, newState);

			// Optionally enhance narrative text with LLM in background
			const prefs = loadPlayerPrefs();
			if (prefs.llmSetting !== 'none') {
				enhanceText(interpolated, buildLLMContext(), prefs).then(enhanced => {
					if (enhanced !== interpolated) {
						narrative = narrative.map((entry, i) =>
							i === 0 ? { ...entry, text: enhanced } : entry
						);
					}
				});
			}
		}

		isLoading = false;
	});

	function handleChoice(choice: Choice) {
		if (!session || !state || !blocks) return;

		const { session: newSession, world: newWorld } = resolveChoice(choice, session, state);

		const choiceLabel = getInterpolatedText(choice.label);

		// Get next node text if there is a next node
		let nextText = '';
		if (choice.nextNodeId) {
			const nextNode = getNodeFromEvent(currentEventId, choice.nextNodeId);
			if (nextNode) {
				nextText = interpolateText(nextNode.text, currentCollapsedRoles, newWorld.characters);
			}
		}

		// Update narrative log — choice labels stay as-is, only narrative text is enhanced
		narrative = [
			...narrative,
			{ text: choiceLabel, choiceLabel: choiceLabel },
			...(nextText ? [{ text: nextText }] : [])
		];

		// Optionally enhance the next-node narrative text with LLM in background
		if (nextText) {
			const prefs = loadPlayerPrefs();
			if (prefs.llmSetting !== 'none') {
				const narrativeIndex = narrative.length - 1;
				enhanceText(nextText, buildLLMContext(), prefs).then(enhanced => {
					if (enhanced !== nextText) {
						narrative = narrative.map((entry, i) =>
							i === narrativeIndex ? { ...entry, text: enhanced } : entry
						);
					}
				});
			}
		}

		// Update questlines
		const updatedProgress = updateQuestlines(newWorld.questlineProgress, blocks.questlines);
		const updatedWorld = { ...newWorld, questlineProgress: updatedProgress };

		worldState.set(updatedWorld);
		playSession.set(newSession);
		saveWorldState(updatedWorld);

		// Check if session should end: dead or exhausted
		if (newSession.isDead || newSession.exhaustion >= newSession.maxExhaustion) {
			// Commit played events to recentEventIds before leaving
			const stateWithRecent = {
				...updatedWorld,
				recentEventIds: [...(updatedWorld.recentEventIds ?? []), ...playedEventIds].slice(-10)
			};
			worldState.set(stateWithRecent);
			saveWorldState(stateWithRecent);
			const endSession = { ...newSession, isComplete: true };
			playSession.set(endSession);
			goto(`${base}/session-end`);
			return;
		}

		// If the event node ended (nextNodeId is null), chain another event
		if (choice.nextNodeId === null) {
			startNextEvent(newSession, updatedWorld);
			return;
		}

		// Otherwise advance within the current event
		const nextNode = getNodeFromEvent(currentEventId, choice.nextNodeId);
		if (nextNode) {
			refreshChoicesForNode(nextNode, newSession, updatedWorld);
		} else {
			availableChoices = [];
		}
	}

	function handleRest() {
		if (!session || !state) return;
		// Commit played events to recentEventIds before leaving
		const updatedState = {
			...state,
			recentEventIds: [...(state.recentEventIds ?? []), ...playedEventIds].slice(-10)
		};
		worldState.set(updatedState);
		saveWorldState(updatedState);
		const endSession = { ...session, isComplete: true };
		playSession.set(endSession);
		goto(`${base}/session-end`);
	}
</script>

{#if isLoading}
	<div class="loading-screen">
		<p>Opening the journal...</p>
	</div>
{:else if errorMessage}
	<div class="error-screen">
		<p>{errorMessage}</p>
		<button onclick={() => goto(`${base}/`)}>Return Home</button>
	</div>
{:else}
<div class="journal-page">
	<!-- Header -->
	<header class="journal-header">
		<div class="header-left">
			<a href="{base}/" class="back-link">&larr; Home</a>
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

				<!-- Current event name -->
				<h2 class="event-title">{currentEventName()}</h2>

				<!-- Narrative log -->
				<div class="narrative">
					{#each narrative as entry, i}
						{#if entry.separator}
							<div class="narrative-separator">
								<span class="separator-line"></span>
								<span class="separator-text">{entry.text}</span>
								<span class="separator-line"></span>
							</div>
						{:else if entry.eventTitle}
							<h3 class="narrative-event-title">{entry.text}</h3>
						{:else if entry.choiceLabel}
							<p class="narrative-choice">&rsaquo; {entry.text}</p>
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
						<button class="btn-end" onclick={() => goto(`${base}/session-end`)}>
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

	.narrative-separator {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 1rem 0;
	}

	.separator-line {
		flex: 1;
		height: 1px;
		background: var(--journal-border);
	}

	.separator-text {
		font-size: 0.85rem;
		color: var(--journal-muted);
		font-style: italic;
		white-space: nowrap;
	}

	.narrative-event-title {
		font-size: 1.2rem;
		color: var(--journal-text);
		font-style: italic;
		opacity: 0.8;
		margin-top: 0.25rem;
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
