<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { playSession } from '$lib/stores/session';
	import { navigationContext } from '$lib/stores/navigation';
	import { escalateStorylines, generateHooks } from '$lib/engine/storyline-manager';
	import { collapseAllRoles } from '$lib/engine/collapse';
	import { interpolateText } from '$lib/engine/text-generator';
	import { saveWorldState } from '$lib/engine/world-loader';
	import type { Hook } from '$lib/types/storyline';
	import type { PlaySession } from '$lib/types/session';
	import { onMount } from 'svelte';

	let hooks = $state<Hook[]>([]);
	let isLoading = $state(true);
	let errorMessage = $state('');

	// Read character/date from navigation context or existing play session
	let navCtx = $derived($navigationContext);
	let existingSession = $derived($playSession);

	let characterId = $derived(
		navCtx.characterId ?? existingSession?.characterId ?? ''
	);
	let targetDate = $derived(
		navCtx.targetDate ?? existingSession?.date ?? null
	);

	function urgencyClass(urgency: Hook['urgency']): string {
		switch (urgency) {
			case 'calm': return 'urgency-calm';
			case 'stirring': return 'urgency-stirring';
			case 'urgent': return 'urgency-urgent';
			case 'critical': return 'urgency-critical';
		}
	}

	function urgencyLabel(urgency: Hook['urgency']): string {
		switch (urgency) {
			case 'calm': return 'Calm';
			case 'stirring': return 'Stirring';
			case 'urgent': return 'Urgent';
			case 'critical': return 'Critical';
		}
	}

	function hookTitle(hook: Hook): string {
		const blocks = $worldBlocks;
		if (!blocks) return hook.eventId;
		const event = blocks.events.find(e => e.id === hook.eventId);
		if (!event) return hook.eventId;
		if (hook.storyline && hook.chapter !== null) {
			return `${event.name} - Chapter ${hook.chapter}`;
		}
		return event.name;
	}

	function interpolatedTeaser(hook: Hook): string {
		// Tease is already sliced to 150 chars from generateHooks.
		// We return it as-is since we don't have collapsed roles yet at this stage.
		return hook.teaserText;
	}

	onMount(() => {
		const savedState = $worldState;
		const savedBlocks = $worldBlocks;

		if (!savedState || !savedBlocks) {
			goto(`${base}/`);
			return;
		}

		const charId = $navigationContext.characterId ?? $playSession?.characterId ?? '';
		if (!charId) {
			goto(`${base}/journal/setup`);
			return;
		}

		// Run escalation
		const escalationResult = escalateStorylines(
			savedState.storylineStates ?? {},
			savedBlocks.events,
			savedState
		);

		// Apply new world facts
		const updatedFacts = { ...savedState.worldFacts, ...escalationResult.newWorldFacts };
		const updatedState = {
			...savedState,
			storylineStates: escalationResult.updatedStates,
			worldFacts: updatedFacts
		};

		worldState.set(updatedState);
		saveWorldState(updatedState);

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
		isLoading = false;

		// Clear forceReroll so it doesn't persist to future navigations
		if ($navigationContext.forceReroll) {
			navigationContext.update(ctx => ({ ...ctx, forceReroll: false }));
		}
	});

	function selectHook(hook: Hook) {
		const savedState = $worldState;
		const savedBlocks = $worldBlocks;
		if (!savedState || !savedBlocks) return;

		const charId = $navigationContext.characterId ?? $playSession?.characterId ?? '';
		if (!charId) return;

		const event = savedBlocks.events.find(e => e.id === hook.eventId);
		if (!event) return;

		// Collapse roles, excluding the player character
		const collapseResults = collapseAllRoles(
			event.roles,
			savedState.characters,
			savedBlocks.archetypes,
			[charId]
		);

		// Add any newly created characters to world state
		const newState = { ...savedState, characters: [...savedState.characters] };
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

		const date = $navigationContext.targetDate ?? $playSession?.date ?? {
			year: savedState.config.dateSystem.startYear,
			season: savedState.config.dateSystem.seasons[0],
			day: 1
		};

		const timeContext = $navigationContext.timeContext ?? $playSession?.timeContext ?? 'present';

		const newSession: PlaySession = {
			characterId: charId,
			date,
			eventTemplateId: event.id,
			collapsedRoles,
			currentNodeId: event.entryNodeId,
			choiceLog: [],
			exhaustion: 0,
			maxExhaustion: 10,
			isDead: false,
			isComplete: false,
			dayTypePreferences: [],
			timeContext
		};

		worldState.set(newState);
		saveWorldState(newState);
		playSession.set(newSession);

		// Store selected hook in navigation context (for reentry recap etc.)
		navigationContext.set({
			...$navigationContext,
			selectedHook: hook
		});

		goto(`${base}/journal`);
	}
</script>

{#if isLoading}
	<div class="morning-loading">
		<p>The day stirs...</p>
	</div>
{:else if errorMessage}
	<div class="morning-error">
		<p>{errorMessage}</p>
		<button onclick={() => goto(`${base}/`)}>Return Home</button>
	</div>
{:else}
<div class="morning-page">
	<header class="morning-header">
		<a href="{base}/journal/setup" class="back-link">&larr; Back</a>
		<h1 class="morning-title">What calls to you today?</h1>
	</header>

	<main class="morning-main">
		<div class="hooks-list">
			{#each hooks as hook}
				<button class="hook-card" onclick={() => selectHook(hook)}>
					<div class="hook-top">
						<span class="hook-title">{hookTitle(hook)}</span>
						<span class="tension-badge {urgencyClass(hook.urgency)}">
							{urgencyLabel(hook.urgency)}
						</span>
					</div>

					{#if hook.isStorylineContinuation}
						<span class="continuation-label">Continuing...</span>
					{/if}

					<p class="hook-teaser">{interpolatedTeaser(hook)}</p>
				</button>
			{/each}

			{#if hooks.length === 0}
				<p class="no-hooks">No paths present themselves today. The world is quiet.</p>
			{/if}
		</div>
	</main>
</div>
{/if}

<style>
	.morning-loading,
	.morning-error {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: var(--journal-bg, #f5f0e8);
		color: var(--journal-text, #3a2e1e);
		font-family: var(--journal-font, Georgia, serif);
		gap: 1rem;
	}

	.morning-error button {
		padding: 0.5rem 1.5rem;
		background: var(--journal-accent, #7a5c3a);
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-family: var(--journal-font, Georgia, serif);
	}

	.morning-page {
		min-height: 100vh;
		background: var(--journal-bg, #f5f0e8);
		color: var(--journal-text, #3a2e1e);
		font-family: var(--journal-font, Georgia, serif);
		display: flex;
		flex-direction: column;
	}

	.morning-header {
		padding: 1.5rem 2rem 0.75rem;
		border-bottom: 1px solid var(--journal-border, #c8b89a);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.back-link {
		color: var(--journal-accent, #7a5c3a);
		text-decoration: none;
		font-size: 0.9rem;
		opacity: 0.8;
		align-self: flex-start;
	}

	.back-link:hover {
		opacity: 1;
	}

	.morning-title {
		font-size: 1.6rem;
		font-weight: normal;
		letter-spacing: 0.04em;
		color: var(--journal-heading, #2a1e0e);
		margin: 0;
	}

	.morning-main {
		flex: 1;
		padding: 2rem;
		max-width: 680px;
		margin: 0 auto;
		width: 100%;
		box-sizing: border-box;
	}

	.hooks-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.hook-card {
		background: var(--journal-parchment, #faf6ee);
		border: 1px solid var(--journal-border, #c8b89a);
		border-radius: 6px;
		padding: 1.25rem 1.5rem;
		text-align: left;
		cursor: pointer;
		transition: box-shadow 0.15s, border-color 0.15s;
		font-family: var(--journal-font, Georgia, serif);
		color: var(--journal-text, #3a2e1e);
		width: 100%;
	}

	.hook-card:hover {
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
		border-color: var(--journal-accent, #7a5c3a);
	}

	.hook-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.4rem;
	}

	.hook-title {
		font-size: 1.05rem;
		font-weight: bold;
		color: var(--journal-heading, #2a1e0e);
	}

	.tension-badge {
		font-size: 0.72rem;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		white-space: nowrap;
	}

	.urgency-calm {
		background: #d4edda;
		color: #2d6a4f;
	}

	.urgency-stirring {
		background: #fff3cd;
		color: #856404;
	}

	.urgency-urgent {
		background: #ffe0cc;
		color: #a34200;
	}

	.urgency-critical {
		background: #f8d7da;
		color: #721c24;
	}

	.continuation-label {
		display: inline-block;
		font-size: 0.78rem;
		color: var(--journal-muted, #8a7a6a);
		font-style: italic;
		margin-bottom: 0.35rem;
	}

	.hook-teaser {
		margin: 0;
		font-size: 0.92rem;
		line-height: 1.6;
		color: var(--journal-text, #3a2e1e);
		opacity: 0.85;
	}

	.no-hooks {
		font-style: italic;
		color: var(--journal-muted, #8a7a6a);
		text-align: center;
		padding: 3rem 0;
	}
</style>
