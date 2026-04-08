<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { playSession, narrativeLog as narrativeLogStore } from '$lib/stores/session';
	import { resolveChoice, getAvailableChoices } from '$lib/engine/choice-resolver';
	import { collapseAllRoles } from '$lib/engine/collapse';
	import { selectEvent } from '$lib/engine/event-selector';
	import { interpolateText } from '$lib/engine/text-generator';
	import { updateQuestlines } from '$lib/engine/questline-tracker';
	import { saveWorldState } from '$lib/engine/world-loader';
	import { enhanceText, type LLMContext } from '$lib/engine/llm-adapter';
	import { loadPlayerPrefs } from '$lib/stores/player';
	import { navigationContext } from '$lib/stores/navigation';
	import type { PlaySession } from '$lib/types/session';
	import type { CollapsedRole } from '$lib/types/session';
	import type { Choice, ChoiceNode } from '$lib/types/blocks';
	import { onMount } from 'svelte';

	// Local reactive state
	let narrative = $state<Array<{ text: string; choiceLabel?: string }>>([]);

	// Keep the narrative log store in sync so session-end can access it
	$effect(() => {
		narrativeLogStore.set(
			narrative.map(e => ({ text: e.text, choiceLabel: e.choiceLabel }))
		);
	});

	let currentNode = $state<ChoiceNode | null>(null);
	let availableChoices = $state<Choice[]>([]);
	let isLoading = $state(true);
	let errorMessage = $state('');

	// Track the current event locally
	let currentEventId = $state('');
	let currentCollapsedRoles = $state<CollapsedRole[]>([]);

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

	let sessionEventName = $state(''); // Set once at session start, never changes

	let currentEventName = $derived(() => {
		if (!blocks || !currentEventId) return '';
		const event = blocks.events.find(e => e.id === currentEventId);
		return event?.name ?? '';
	});

	// Character overview panel
	let showCharacterPanel = $state(false);

	let characterBio = $derived(() => {
		if (!currentCharacter || !state || !session) return '';
		const char = currentCharacter;
		const parts: string[] = [];

		// Age
		const currentYear = session.date.year;
		const age = currentYear - char.birthDate.year;
		if (age > 0) parts.push(`${age} years old`);

		// Location
		if (char.locationId) {
			const loc = state.locations.find(l => l.id === char.locationId);
			parts.push(loc ? loc.name : char.locationId);
		}

		// Faction standing
		const factionEntries = Object.entries(char.factions).filter(([_, v]) => v > 0);
		if (factionEntries.length > 0) {
			const topFaction = factionEntries.sort((a, b) => b[1] - a[1])[0];
			const fName = topFaction[0].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			parts.push(`affiliated with ${fName}`);
		}

		// Alive/dead
		if (!char.alive) {
			parts.push('deceased');
		}

		return parts.join('. ') + (parts.length > 0 ? '.' : '');
	});

	let characterTraits = $derived(() => {
		if (!currentCharacter) return [];
		return Object.entries(currentCharacter.traits).map(([key, value]) => ({
			label: key.substring(0, 3).toUpperCase(),
			value
		}));
	});

	let topRelationships = $derived(() => {
		if (!currentCharacter || !state) return [];
		const rels = Object.entries(currentCharacter.relationships);
		return rels
			.map(([targetId, rel]) => {
				const target = state!.characters.find(c => c.id === targetId);
				const topAxis = Object.entries(rel.axes).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
				return {
					name: target?.name ?? targetId,
					archetype: target?.archetypeId ?? '',
					axis: topAxis?.[0] ?? '',
					value: topAxis?.[1] ?? 0,
					tags: rel.tags
				};
			})
			.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
			.slice(0, 3);
	});

	let recentHistory = $derived(() => {
		if (!session || !state) return [];
		return state.timeline
			.filter(e => e.characterId === session!.characterId)
			.slice(-3)
			.reverse()
			.map(e => ({
				date: `${e.date.season}, Day ${e.date.day}, Year ${e.date.year}`,
				summary: e.summary
			}));
	});

	function buildLLMContext(lastChoiceLabel?: string): LLMContext {
		// Collect recent narrative text for continuity
		const recentNarrative = narrative
			.filter(e => !e.choiceLabel)
			.map(e => e.text)
			.slice(-4);

		return {
			characterName: currentCharacter?.name ?? '',
			characterArchetype: currentCharacter?.archetypeId ?? '',
			locationName: currentCharacter?.locationId,
			season: session?.date.season,
			timeContext: session?.timeContext ?? 'present',
			previousChoices: session?.choiceLog.map(c => c.text).slice(-3),
			previousNarrative: recentNarrative,
			lastChoice: lastChoiceLabel
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

	function endEventDay(currentSession: PlaySession, currentWorld: NonNullable<typeof state>) {
		// Event chain ended: wind down the day
		// Check if there's still energy and an unvisited path from entry
		const event = blocks?.events.find(e => e.id === currentEventId);
		const exhaustionRatio = currentSession.exhaustion / currentSession.maxExhaustion;

		if (event && exhaustionRatio < 0.7) {
			// Still daylight -- offer to re-enter from the beginning of the event
			const entryNode = event.nodes[event.entryNodeId];
			if (entryNode) {
				// Offer "There is still daylight" as a synthetic choice
				narrative = [
					...narrative,
					{ text: 'There is still daylight. The story is not yet finished.' }
				];
				// Provide a single synthetic continue choice rendered via isComplete flag logic
				// We set a special state so the template can offer a "continue" button
				const updatedSession = { ...currentSession, currentNodeId: event.entryNodeId };
				playSession.set(updatedSession);
				refreshChoicesForNode(entryNode, updatedSession, currentWorld);
				return;
			}
		}

		// Day draws to a close
		narrative = [...narrative, { text: 'The day draws to a close.' }];
		const endSession = { ...currentSession, isComplete: true };
		playSession.set(endSession);
		availableChoices = [];
	}

	// Legacy stub kept for import compatibility -- not used in single-event mode
	function _unusedStartNextEvent(currentSession: PlaySession, currentWorld: NonNullable<typeof state>) {
		if (!blocks) return;
		const currentSeason = currentWorld.config.dateSystem.seasons[0];
		const preferences = currentSession.dayTypePreferences ?? [];
		let event = selectEvent(
			blocks.events,
			currentWorld,
			currentSeason,
			preferences,
			blocks.questlines
		);
		if (!event) {
			const endSession = { ...currentSession, isComplete: true };
			playSession.set(endSession);
			goto(`${base}/session-end`);
			return;
		}
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
		currentEventId = event.id;
		currentCollapsedRoles = newRoles;
		const updatedSession = {
			...currentSession,
			eventTemplateId: event.id,
			collapsedRoles: newRoles,
			currentNodeId: event.entryNodeId
		};
		worldState.set(newWorld);
		playSession.set(updatedSession);
		const entryNode = event.nodes[event.entryNodeId];
		if (entryNode) {
			const interpolated = interpolateText(entryNode.text, newRoles, newWorld.characters);
			narrative = [...narrative, { text: interpolated }];
			refreshChoicesForNode(entryNode, updatedSession, newWorld);
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

		// Check if a session was already set up by the morning menu
		const existingSession = $playSession;
		if (existingSession && !existingSession.isComplete) {
			// Session was pre-created by morning menu -- use it
			currentEventId = existingSession.eventTemplateId;
			currentCollapsedRoles = existingSession.collapsedRoles;
			const initialEvent = savedBlocks.events.find(e => e.id === existingSession.eventTemplateId);
			sessionEventName = initialEvent?.name ?? '';

			const event = savedBlocks.events.find(e => e.id === existingSession.eventTemplateId);
			if (event) {
				const entryNode = event.nodes[existingSession.currentNodeId];
				if (entryNode) {
					const interpolated = interpolateText(entryNode.text, existingSession.collapsedRoles, savedState.characters);

					// Check for reentry recap from navigation context
					const navCtxVal = $navigationContext;
					const recap = navCtxVal.selectedHook?.reentryRecap ?? null;
					if (recap) {
						narrative = [{ text: recap }, { text: interpolated }];
					} else {
						narrative = [{ text: interpolated }];
					}

					refreshChoicesForNode(entryNode, existingSession, savedState);

					// Optionally enhance narrative text with LLM in background
					const prefs = loadPlayerPrefs();
					if (prefs.llmSetting !== 'none') {
						const targetIndex = narrative.length - 1;
						enhanceText(interpolated, buildLLMContext(), prefs).then(enhanced => {
							if (enhanced !== interpolated) {
								narrative = narrative.map((entry, i) =>
									i === targetIndex ? { ...entry, text: enhanced } : entry
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
		sessionEventName = event.name;

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
				enhanceText(nextText, buildLLMContext(choiceLabel), prefs).then(enhanced => {
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
			saveWorldState(updatedWorld);
			const endSession = { ...newSession, isComplete: true };
			playSession.set(endSession);
			goto(`${base}/session-end`);
			return;
		}

		// If the event node ended (nextNodeId is null), wind down the day
		if (choice.nextNodeId === null) {
			endEventDay(newSession, updatedWorld);
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
		saveWorldState(state);
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

				<!-- Character overview toggle -->
				<button class="character-toggle" onclick={() => showCharacterPanel = !showCharacterPanel}>
					{showCharacterPanel ? '▾' : '▸'} Character
				</button>

				{#if showCharacterPanel}
					<div class="character-panel">
						{#if characterBio()}
							<div class="panel-bio">{characterBio()}</div>
						{/if}

						<div class="panel-section">
							<div class="panel-label">Traits</div>
							<div class="trait-list">
								{#each characterTraits() as trait}
									<span class="trait-badge">{trait.label} {trait.value}</span>
								{/each}
							</div>
						</div>

						{#if currentCharacter?.skills.length}
							<div class="panel-section">
								<div class="panel-label">Skills</div>
								<div class="skill-list">
									{#each currentCharacter.skills as skill}
										<span class="skill-tag">{skill}</span>
									{/each}
								</div>
							</div>
						{/if}

						{#if topRelationships().length > 0}
							<div class="panel-section">
								<div class="panel-label">Relationships</div>
								{#each topRelationships() as rel}
									<div class="rel-row">
										<span class="rel-name">{rel.name}</span>
										{#if rel.archetype}<span class="rel-archetype">{rel.archetype}</span>{/if}
										<span class="rel-axis">{rel.axis}: {rel.value > 0 ? '+' : ''}{rel.value}</span>
										{#each rel.tags as tag}
											<span class="rel-tag">{tag}</span>
										{/each}
									</div>
								{/each}
							</div>
						{/if}

						{#if recentHistory().length > 0}
							<div class="panel-section">
								<div class="panel-label">Recent History</div>
								{#each recentHistory() as entry}
									<div class="history-entry">
										<span class="history-date">{entry.date}</span>
										<span class="history-summary">{entry.summary}</span>
									</div>
								{/each}
							</div>
						{/if}

						<div class="panel-section">
							<div class="panel-label">This Session</div>
							<div class="session-stats">
								<span>{session?.choiceLog.length ?? 0} choices made</span>
								<span>Exhaustion: {session?.exhaustion ?? 0}/{session?.maxExhaustion ?? 10}</span>
							</div>
						</div>
					</div>
				{/if}

				<!-- Current event name -->
				<h2 class="event-title">{sessionEventName || currentEventName()}</h2>

				<!-- Narrative log -->
				<div class="narrative">
					{#each narrative as entry, i}
						{#if entry.choiceLabel}
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
		background: var(--journal-bg);
		border-bottom: 1px solid var(--journal-border);
		gap: 1rem;
		position: sticky;
		top: 0;
		z-index: 10;
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

	/* Character overview panel */
	.character-toggle {
		background: none;
		border: none;
		color: var(--journal-accent);
		font-family: var(--journal-font);
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0.25rem 0;
		opacity: 0.7;
		transition: opacity 0.15s;
	}

	.character-toggle:hover {
		opacity: 1;
	}

	.character-panel {
		background: rgba(139, 105, 20, 0.06);
		border: 1px solid var(--journal-border);
		border-radius: 4px;
		padding: 1rem 1.25rem;
		margin-bottom: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.panel-bio {
		font-size: 0.85rem;
		line-height: 1.5;
		opacity: 0.75;
		font-style: italic;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--journal-border);
	}

	.panel-section {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.panel-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.5;
	}

	.trait-list,
	.skill-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.trait-badge {
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		background: rgba(139, 105, 20, 0.1);
		border: 1px solid var(--journal-border);
		border-radius: 3px;
	}

	.skill-tag {
		font-size: 0.75rem;
		padding: 0.1rem 0.4rem;
		background: rgba(58, 42, 26, 0.08);
		border-radius: 3px;
		font-style: italic;
	}

	.rel-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.85rem;
		flex-wrap: wrap;
	}

	.rel-name {
		font-weight: 600;
	}

	.rel-archetype {
		font-size: 0.75rem;
		opacity: 0.5;
		font-style: italic;
	}

	.rel-axis {
		font-size: 0.75rem;
		opacity: 0.7;
	}

	.rel-tag {
		font-size: 0.65rem;
		padding: 0.05rem 0.3rem;
		background: rgba(139, 105, 20, 0.12);
		border-radius: 2px;
		opacity: 0.8;
	}

	.history-entry {
		display: flex;
		gap: 0.5rem;
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.history-date {
		opacity: 0.5;
		white-space: nowrap;
		font-size: 0.75rem;
	}

	.history-summary {
		opacity: 0.8;
	}

	.session-stats {
		display: flex;
		gap: 1rem;
		font-size: 0.8rem;
		opacity: 0.7;
	}

	@media (max-width: 480px) {
		.journal-header {
			flex-wrap: wrap;
			gap: 0.5rem;
			padding: 0.5rem 1rem;
		}

		.header-left,
		.header-right {
			flex: none;
		}

		.header-center {
			flex: none;
			order: -1;
			width: 100%;
			text-align: center;
		}

		.parchment {
			padding: 1.5rem 1.25rem;
		}
	}
</style>
