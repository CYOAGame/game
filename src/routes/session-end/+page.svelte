<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { playSession, narrativeLog as narrativeLogStore } from '$lib/stores/session';
	import { saveWorldState, loadWorldState } from '$lib/engine/world-loader';
	import { generatePastDate, generateFutureDate, suggestCharacters, canGoToPast } from '$lib/engine/timeline';
	import { navigationContext } from '$lib/stores/navigation';
	import type { CharacterSuggestion } from '$lib/engine/timeline';
	import { githubState } from '$lib/stores/github';
	import { serializeWorldStateToFiles, saveWithPR, queuePendingChanges } from '$lib/git/repo-writer';
	import { formatJournalEntry, journalFilePath } from '$lib/git/journal-formatter';
	import { AuthExpiredError } from '$lib/git/auth-errors';
	import InvitesBadge from '$lib/components/InvitesBadge.svelte';

	// Derived from stores
	let session = $derived($playSession);
	let state = $derived($worldState);
	let narrativeLog = $derived($narrativeLogStore);
	let syncStatus = $derived($githubState.syncStatus);

	let currentCharacter = $derived(
		session && state ? state.characters.find(c => c.id === session!.characterId) ?? null : null
	);

	let choiceCount = $derived(session ? session.choiceLog.length : 0);

	// Timeline navigation state
	let showingSuggestions = $state(false);
	let suggestions = $state<CharacterSuggestion[]>([]);
	let narrativeExpanded = $state(false);

	let canGoToPastDerived = $derived(
		session && currentCharacter && state
			? canGoToPast(currentCharacter, session.date, state.config.dateSystem.seasons, state.timeline)
			: false
	);

	let canGoToFuture = $derived(
		session && currentCharacter ? currentCharacter.alive && !session.isDead : false
	);

	function formatFactionName(id: string): string {
		const names: Record<string, string> = {
			town_guard: 'Town Guard',
			craftsmen_guild: "Craftsmen's Guild",
			merchant_guild: 'Merchant Guild',
			village_folk: 'Village Folk'
		};
		return names[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
	}

	function formatStatName(id: string): string {
		return id.charAt(0).toUpperCase() + id.slice(1);
	}

	let choiceTags = $derived((): string[] => {
		if (!session || session.choiceLog.length === 0) return [];
		const tags = new Set<string>();
		for (const record of session.choiceLog) {
			for (const consequence of record.consequences) {
				if (consequence.type === 'faction') {
					tags.add(`${formatFactionName(consequence.target)} reputation`);
				}
				if (consequence.type === 'stat') {
					const direction = typeof consequence.value === 'number' && consequence.value > 0 ? 'increased' : 'decreased';
					tags.add(`${formatStatName(consequence.target)} ${direction}`);
				}
				if (consequence.type === 'questline') {
					tags.add('Affected the questline');
				}
				if (consequence.type === 'relationship') {
					tags.add('Relationship changed');
				}
			}
		}
		return Array.from(tags);
	});

	let sessionSummary = $derived((): string => {
		if (!session) return '';
		if (session.isDead) return `${currentCharacter?.name ?? 'Your character'} did not survive the day.`;
		if (choiceCount === 0) return 'The day passed quietly, without incident.';
		// Build a summary from the choices made
		const choiceTexts = session.choiceLog.map(c => c.text);
		if (choiceTexts.length <= 3) {
			return `${currentCharacter?.name ?? 'You'} ${choiceTexts.join(', then ')}.`;
		}
		// For longer sessions, show first and last few
		const first = choiceTexts.slice(0, 2).join(', ');
		const last = choiceTexts[choiceTexts.length - 1];
		return `${currentCharacter?.name ?? 'You'} ${first}, and after ${choiceCount - 2} more decisions, ${last}.`;
	});

	let dateDisplay = $derived((): string => {
		if (!session || !state) return '';
		const season = session.date.season;
		const seasonCapitalized = season.charAt(0).toUpperCase() + season.slice(1);
		return `${seasonCapitalized}, Year ${session.date.year}, Day ${session.date.day}`;
	});

	/**
	 * Save the current session: create timeline entry, update world state, push to GitHub.
	 * Returns the updated world state.
	 */
	async function saveSession(): Promise<typeof state> {
		if (!state || !session) return state;

		// Create a timeline entry for this journal session
		const allConsequences: Array<{ type: string; target: string; value: number | string | boolean }> = [];
		for (const record of session.choiceLog) {
			for (const c of record.consequences) {
				allConsequences.push({ type: c.type, target: c.target, value: c.value });
			}
		}

		const entry = {
			id: `entry_${Date.now()}`,
			date: session.date,
			characterId: session.characterId,
			eventTemplateId: session.eventTemplateId,
			choicesMade: session.choiceLog.map(c => c.choiceId),
			consequences: allConsequences,
			summary: `${currentCharacter?.name ?? 'Unknown'} made ${session.choiceLog.length} ${session.choiceLog.length === 1 ? 'choice' : 'choices'}.${session.isDead ? ' They did not survive.' : ''}`
		};

		// Track played character
		const playedIds = state.playedCharacterIds.includes(session.characterId)
			? state.playedCharacterIds
			: [...state.playedCharacterIds, session.characterId];

		let updated = {
			...state,
			timeline: [...state.timeline, entry],
			playedCharacterIds: playedIds
		};

		// Update storyline tension
		const blocks = $worldBlocks;
		if (blocks && session) {
			const playedEvent = blocks.events.find(e => e.id === session!.eventTemplateId);
			const playedStoryline = playedEvent?.storyline;

			const updatedStorylines = { ...(updated.storylineStates ?? {}) };

			for (const [name, slState] of Object.entries(updatedStorylines)) {
				if (name === playedStoryline) {
					updatedStorylines[name] = {
						...slState,
						tension: 0,
						lastPlayerSession: entry.id
					};
				} else {
					const bump = 2 + Math.floor(Math.random() * 4); // +2 to +5
					updatedStorylines[name] = {
						...slState,
						tension: Math.min(100, slState.tension + bump)
					};
				}
			}

			updated = { ...updated, storylineStates: updatedStorylines };
		}

		worldState.set(updated);
		saveWorldState(updated);

		// If GitHub is connected, push to repo
		const ghState = $githubState;
		if (ghState.isConnected && ghState.token) {
			githubState.update(s => ({ ...s, syncStatus: 'syncing' }));
			try {
				const stateFiles = serializeWorldStateToFiles(updated);
				// Add journal entry
				if (currentCharacter && session) {
					const journalMd = formatJournalEntry(currentCharacter, session.date, session.choiceLog, session.isDead, narrativeLog);
					const journalPath = journalFilePath(currentCharacter, session.date);
					stateFiles.set(journalPath, journalMd);
				}
				const commitMsg = `${currentCharacter?.name ?? 'Unknown'} — ${session?.date.season}, Day ${session?.date.day}, Year ${session?.date.year}`;
				const authorLabel = ghState.displayName ?? ghState.username;
				const author = ghState.displayName
					? { name: ghState.displayName, email: `${ghState.displayName.toLowerCase().replace(/\s+/g, '-')}@players.journal-rpg.local` }
					: undefined;
				const result = await saveWithPR(
					ghState.token, ghState.repoOwner, ghState.repoName,
					session.characterId,
					currentCharacter?.name ?? 'Unknown',
					stateFiles, commitMsg,
					authorLabel,
					author
				);
				if (result.success) {
					githubState.update(s => ({ ...s, syncStatus: 'synced' }));
				} else {
					queuePendingChanges(stateFiles, commitMsg);
					githubState.update(s => ({ ...s, syncStatus: 'pending', syncError: result.error }));
				}
			} catch (err: any) {
				if (err instanceof AuthExpiredError) {
					// clearAuth() was already called inside handleRequest — just bounce.
					goto(`${base}/login?error=expired`);
					return updated;
				}
				githubState.update(s => ({ ...s, syncStatus: 'error', syncError: err.message }));
			}
		}

		return updated;
	}

	function selectSuggestion(suggestion: CharacterSuggestion) {
		if (suggestion.type === 'new') {
			navigationContext.set({ mode: 'new', timeContext: 'present' });
		} else {
			navigationContext.set({
				mode: 'pre-selected',
				characterId: suggestion.characterId!,
				timeContext: 'present'
			});
		}
		playSession.set(null);
		goto(`${base}/journal/setup`);
	}

	// --- Keep this day actions (all auto-save) ---

	async function handleForward() {
		if (!session || !currentCharacter || !state) return;
		await saveSession();
		const futureDate = generateFutureDate(currentCharacter, session.date, state.config.dateSystem, state.timeline);
		if (!futureDate) return;
		navigationContext.set({
			mode: 'pre-selected',
			characterId: session.characterId,
			targetDate: futureDate,
			timeContext: 'future'
		});
		playSession.set(null);
		goto(`${base}/journal/setup`);
	}

	async function handleBackward() {
		if (!session || !currentCharacter || !state) return;
		await saveSession();
		const pastDate = generatePastDate(currentCharacter, session.date, state.config.dateSystem, state.timeline);
		if (!pastDate) return;
		navigationContext.set({
			mode: 'pre-selected',
			characterId: session.characterId,
			targetDate: pastDate,
			timeContext: 'past'
		});
		playSession.set(null);
		goto(`${base}/journal/setup`);
	}

	async function handleSomeoneElse() {
		if (!state || !session) return;
		await saveSession();
		suggestions = suggestCharacters(session.characterId, state, state.playedCharacterIds);
		showingSuggestions = true;
	}

	async function handleSaveAndMenu() {
		await saveSession();
		playSession.set(null);
		navigationContext.set({ mode: 'new', timeContext: 'present' });
		goto(`${base}/`);
	}

	// --- Toss this day actions (no save) ---

	function handleUndoRedo() {
		const saved = loadWorldState();
		if (saved) {
			worldState.set(saved);
		}
		if (session) {
			navigationContext.set({
				mode: 'pre-selected',
				characterId: session.characterId,
				targetDate: session.date,
				timeContext: session.timeContext,
				forceReroll: true
			});
		}
		playSession.set(null);
		goto(`${base}/journal/morning`);
	}

	function handleDiscardMenu() {
		const saved = loadWorldState();
		if (saved) {
			worldState.set(saved);
		}
		playSession.set(null);
		navigationContext.set({ mode: 'new', timeContext: 'present' });
		goto(`${base}/`);
	}
</script>

{#snippet narrativeBody()}
	{#if narrativeLog && narrativeLog.length > 0}
		{#each narrativeLog as entry}
			{#if entry.choiceLabel}
				<blockquote>{entry.text}</blockquote>
			{:else}
				<p>{entry.text}</p>
			{/if}
		{/each}
	{:else if session && session.choiceLog.length > 0}
		{#each session.choiceLog as record}
			{#if record.narrativeText}
				<p>{record.narrativeText}</p>
			{/if}
			<blockquote>{record.text}</blockquote>
		{/each}
	{:else if !session?.isDead}
		<p class="quiet-day">A quiet day passed without incident.</p>
	{/if}
{/snippet}

<div class="session-end-page">
	<!-- Header -->
	<header class="session-end-header">
		<a href="{base}/" class="back-link">← Home</a>
		<h1 class="page-title">Journal Entry Complete</h1>
		<div class="sync-badge-wrap">
			<InvitesBadge />
			{#if syncStatus === 'syncing'}
				<span class="sync-badge sync-syncing">Syncing...</span>
			{:else if syncStatus === 'synced'}
				<span class="sync-badge sync-synced">Synced</span>
			{:else if syncStatus === 'pending'}
				<span class="sync-badge sync-pending">Pending</span>
			{:else if syncStatus === 'error'}
				<span class="sync-badge sync-error">Sync Error</span>
			{/if}
		</div>
	</header>

	<!-- Desktop: split panel / Mobile: single column -->
	<div class="session-end-body">
		<!-- Narrative panel (desktop: left side, mobile: collapsible at bottom) -->
		<div class="narrative-panel">
			<div class="narrative-panel-header">
				<h2 class="char-name">{currentCharacter?.name ?? 'Unknown Character'}</h2>
				<span class="entry-date">{dateDisplay()}</span>
			</div>
			<div class="narrative-panel-label">Full journal entry</div>
			<div class="narrative-text">
				{@render narrativeBody()}
				{#if session?.isDead}
					<div class="death-notice">
						<span class="death-icon">✦</span>
						<span>{currentCharacter?.name ?? 'This character'} did not survive this day.</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- Action sidebar (desktop: right side, mobile: main content area) -->
		<div class="action-sidebar">
			<!-- Mobile-only: compact identity + summary -->
			<div class="mobile-identity">
				<h2 class="char-name">{currentCharacter?.name ?? 'Unknown Character'}</h2>
				<span class="entry-date">{dateDisplay()}</span>
			</div>

			<div class="mobile-summary">
				<div class="section-label">What happened</div>
				<p class="summary-text">{sessionSummary()}</p>
				{#if session?.isDead}
					<div class="death-notice">
						<span class="death-icon">✦</span>
						<span>This character's story has ended.</span>
					</div>
				{/if}
			</div>

			<!-- Tags (both layouts) -->
			{#if choiceTags().length > 0}
				<div class="tags-section">
					<div class="section-label">This entry touched on</div>
					<div class="tags-list">
						{#each choiceTags() as tag}
							<span class="tag">{tag}</span>
						{/each}
					</div>
				</div>
			{/if}

			<div class="divider"></div>

			<!-- Keep this day -->
			{#if showingSuggestions}
				<div class="suggestions-section">
					<div class="section-label">Play as...</div>
					<div class="suggestions">
						{#each suggestions as suggestion}
							<button class="suggestion-card" onclick={() => selectSuggestion(suggestion)}>
								<span class="btn-title">
									{#if suggestion.type === 'new'}
										Someone New
									{:else}
										{suggestion.characterName} — {suggestion.archetypeId}
									{/if}
								</span>
								<span class="btn-sub">{suggestion.contextLine}</span>
							</button>
						{/each}
					</div>
				</div>
			{:else}
				<div class="keep-section">
					<div class="section-label">Keep this day and...</div>
					<div class="keep-grid">
						<button class="keep-btn" disabled={!canGoToFuture} onclick={handleForward}>
							<span class="keep-icon" aria-hidden="true">→</span>
							<span class="keep-label">Forward in Time</span>
							<span class="keep-sub">
								{#if session?.isDead || (currentCharacter && !currentCharacter.alive)}
									Story has ended
								{:else}
									Continue later
								{/if}
							</span>
						</button>
						<button class="keep-btn" disabled={!canGoToPastDerived} onclick={handleBackward}>
							<span class="keep-icon" aria-hidden="true">←</span>
							<span class="keep-label">Backward in Time</span>
							<span class="keep-sub">Revisit an earlier moment</span>
						</button>
						<button class="keep-btn" onclick={handleSomeoneElse}>
							<span class="keep-icon" aria-hidden="true">⇄</span>
							<span class="keep-label">Play Another Character</span>
							<span class="keep-sub">Different eyes</span>
						</button>
						<button class="keep-btn" onclick={handleSaveAndMenu}>
							<span class="keep-icon" aria-hidden="true">⌂</span>
							<span class="keep-label">Save & Menu</span>
							<span class="keep-sub">Done for now</span>
						</button>
					</div>
				</div>
			{/if}

			<div class="divider"></div>

			<!-- Toss this day -->
			<div class="toss-section">
				<div class="section-label">Toss this day</div>
				<div class="toss-row">
					<button class="toss-btn" onclick={handleUndoRedo}>
						<span class="toss-label">Undo & Redo</span>
						<span class="toss-sub">Re-roll hooks, start fresh</span>
					</button>
					<button class="toss-btn" onclick={handleDiscardMenu}>
						<span class="toss-label">Discard & Menu</span>
						<span class="toss-sub">Throw away, go home</span>
					</button>
				</div>
			</div>

			<!-- Mobile-only: expandable narrative -->
			<div class="divider mobile-narrative-divider"></div>
			<div class="mobile-narrative">
				<button class="narrative-toggle" onclick={() => narrativeExpanded = !narrativeExpanded} class:open={narrativeExpanded} aria-expanded={narrativeExpanded} aria-controls="mobile-narrative-body">
					<span class="narrative-toggle-label">📖 Read the full journal entry</span>
					<span class="narrative-toggle-arrow" aria-hidden="true">▼</span>
				</button>
				{#if narrativeExpanded}
					<div class="narrative-expand-body" id="mobile-narrative-body">
						{@render narrativeBody()}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.session-end-page {
		min-height: 100vh;
		background-color: var(--session-end-bg);
		color: var(--session-end-text);
		font-family: var(--journal-font);
		display: flex;
		flex-direction: column;
	}

	/* ── Header ── */
	.session-end-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1.5rem;
		border-bottom: 1px solid var(--session-end-border);
		background: rgba(255, 255, 255, 0.03);
	}
	.back-link {
		color: var(--session-end-text);
		text-decoration: none;
		font-size: 0.85rem;
		opacity: 0.6;
		transition: opacity 0.15s;
		flex: 1;
	}
	.back-link:hover { opacity: 1; }
	.page-title {
		font-size: 1.1rem;
		font-weight: normal;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		opacity: 0.7;
		text-align: center;
		flex: 2;
	}
	.sync-badge-wrap {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.sync-badge {
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 0.2rem 0.55rem;
		border-radius: 3px;
		border: 1px solid transparent;
	}
	.sync-syncing { color: #9ab8e8; border-color: rgba(90, 140, 210, 0.4); background: rgba(90, 140, 210, 0.1); }
	.sync-synced { color: #8ecf8e; border-color: rgba(80, 160, 80, 0.4); background: rgba(80, 160, 80, 0.1); }
	.sync-pending { color: #d4b96a; border-color: rgba(180, 140, 60, 0.4); background: rgba(180, 140, 60, 0.1); }
	.sync-error { color: #e09090; border-color: rgba(180, 60, 60, 0.4); background: rgba(180, 60, 60, 0.1); }

	/* ── Split layout (desktop) ── */
	.session-end-body {
		flex: 1;
		display: flex;
		height: calc(100vh - 52px);
		overflow: hidden;
	}

	/* ── Narrative panel (left) ── */
	.narrative-panel {
		flex: 1;
		overflow-y: auto;
		padding: 2rem 2.5rem;
		border-right: 1px solid var(--session-end-border);
		background: rgba(0, 0, 0, 0.08);
	}
	.narrative-panel-header { margin-bottom: 1.5rem; }
	.narrative-panel-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		opacity: 0.4;
		margin-bottom: 1rem;
	}
	.char-name {
		font-size: 1.6rem;
		font-weight: normal;
		color: var(--journal-accent);
		margin-bottom: 0.25rem;
	}
	.entry-date {
		font-size: 0.82rem;
		opacity: 0.45;
		letter-spacing: 0.06em;
	}
	.narrative-text {
		line-height: 1.85;
		font-size: 0.95rem;
	}
	.narrative-text p {
		margin-bottom: 1.1rem;
		opacity: 0.85;
	}
	.narrative-text blockquote {
		border-left: 2px solid var(--journal-accent);
		padding-left: 1rem;
		margin: 0.85rem 0;
		color: var(--journal-accent);
		opacity: 0.9;
		font-style: italic;
	}
	.quiet-day { font-style: italic; opacity: 0.6; }

	/* ── Action sidebar (right) ── */
	.action-sidebar {
		width: 320px;
		min-width: 280px;
		overflow-y: auto;
		padding: 2rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* ── Shared elements ── */
	.section-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		opacity: 0.4;
		margin-bottom: 0.5rem;
	}
	.divider { height: 1px; background: var(--session-end-border); opacity: 0.5; }
	.tags-list { display: flex; flex-wrap: wrap; gap: 0.4rem; }
	.tag {
		padding: 0.2rem 0.55rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--session-end-border);
		border-radius: 20px;
		font-size: 0.72rem;
		opacity: 0.7;
	}
	.death-notice {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
		color: #c07060;
		margin-top: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid rgba(192, 112, 96, 0.3);
		border-radius: 4px;
		background: rgba(192, 112, 96, 0.07);
	}
	.death-icon { font-size: 0.7rem; opacity: 0.75; }

	/* ── Keep grid ── */
	.keep-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.keep-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 1rem 0.65rem;
		background: rgba(139, 105, 20, 0.06);
		border: 1px solid rgba(139, 105, 20, 0.3);
		border-radius: 5px;
		cursor: pointer;
		color: var(--session-end-text);
		font-family: var(--journal-font);
		gap: 0.35rem;
		transition: background 0.15s, border-color 0.15s, transform 0.1s;
	}
	.keep-btn:hover:not(:disabled) {
		background: rgba(139, 105, 20, 0.15);
		border-color: var(--journal-accent);
		transform: translateY(-1px);
	}
	.keep-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.keep-icon {
		font-size: 1.3rem;
		color: var(--journal-accent);
		opacity: 0.8;
	}
	.keep-label {
		font-size: 0.82rem;
		color: var(--journal-accent);
	}
	.keep-sub {
		font-size: 0.68rem;
		opacity: 0.45;
		line-height: 1.4;
	}

	/* ── Toss row ── */
	.toss-row {
		display: flex;
		gap: 0.6rem;
	}
	.toss-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 0.55rem 0.5rem;
		background: transparent;
		border: 1px solid rgba(74, 74, 58, 0.35);
		border-radius: 4px;
		cursor: pointer;
		color: var(--session-end-text);
		font-family: var(--journal-font);
		opacity: 0.5;
		gap: 0.1rem;
		transition: opacity 0.15s, background 0.15s, border-color 0.15s;
	}
	.toss-btn:hover {
		opacity: 1;
		background: rgba(180, 60, 60, 0.08);
		border-color: rgba(180, 60, 60, 0.3);
	}
	.toss-label { font-size: 0.8rem; }
	.toss-sub { font-size: 0.65rem; opacity: 0.5; }

	/* ── Suggestions ── */
	.suggestions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.suggestion-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding: 0.75rem 1rem;
		background: rgba(139, 105, 20, 0.06);
		border: 1px solid rgba(139, 105, 20, 0.3);
		border-radius: 4px;
		cursor: pointer;
		font-family: var(--journal-font);
		color: var(--session-end-text);
		text-align: left;
		gap: 0.15rem;
		width: 100%;
		transition: background 0.15s, border-color 0.15s;
	}
	.suggestion-card:hover {
		border-color: var(--journal-accent);
		background: rgba(139, 105, 20, 0.12);
	}
	.btn-title { font-size: 0.9rem; color: var(--journal-accent); }
	.btn-sub { font-size: 0.72rem; opacity: 0.45; }

	/* ── Summary text (mobile) ── */
	.summary-text {
		font-size: 0.92rem;
		line-height: 1.7;
		opacity: 0.8;
	}

	/* ── Mobile narrative toggle ── */
	.narrative-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		cursor: pointer;
		padding: 0.6rem 0.85rem;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid rgba(74, 74, 58, 0.4);
		border-radius: 4px;
		font-family: var(--journal-font);
		color: var(--session-end-text);
		transition: background 0.15s;
	}
	.narrative-toggle:hover { background: rgba(255, 255, 255, 0.05); }
	.narrative-toggle-label { font-size: 0.85rem; opacity: 0.6; }
	.narrative-toggle-arrow {
		font-size: 0.75rem;
		opacity: 0.4;
		transition: transform 0.2s;
	}
	.narrative-toggle.open .narrative-toggle-arrow { transform: rotate(180deg); }

	.narrative-expand-body {
		padding: 1.25rem;
		border: 1px solid rgba(74, 74, 58, 0.3);
		border-top: none;
		border-radius: 0 0 4px 4px;
		background: rgba(0, 0, 0, 0.12);
		line-height: 1.8;
		font-size: 0.95rem;
		max-height: 400px;
		overflow-y: auto;
	}
	.narrative-expand-body p { margin-bottom: 1rem; opacity: 0.85; }
	.narrative-expand-body blockquote {
		border-left: 2px solid var(--journal-accent);
		padding-left: 1rem;
		margin: 0.75rem 0;
		color: var(--journal-accent);
		opacity: 0.9;
		font-style: italic;
	}

	/* ── Desktop: hide mobile-only elements ── */
	.mobile-identity,
	.mobile-summary,
	.mobile-narrative,
	.mobile-narrative-divider { display: none; }

	/* ── Mobile (<768px): single column, decision-first ── */
	@media (max-width: 768px) {
		.session-end-body {
			flex-direction: column;
			height: auto;
			overflow: visible;
		}
		.narrative-panel { display: none; }
		.action-sidebar {
			width: 100%;
			min-width: unset;
			padding: 1.75rem 1.25rem;
		}
		.mobile-identity,
		.mobile-summary,
		.mobile-narrative,
		.mobile-narrative-divider { display: block; }
		.mobile-identity { margin-bottom: 0.5rem; }
		.char-name { font-size: 1.5rem; }
	}

	/* ── Small phones ── */
	@media (max-width: 480px) {
		.session-end-header {
			flex-wrap: wrap;
			gap: 0.25rem;
			padding: 0.5rem 1rem;
		}
		.page-title {
			flex: none;
			width: 100%;
			order: -1;
			font-size: 0.85rem;
		}
		.keep-grid { gap: 0.4rem; }
		.keep-btn { padding: 0.75rem 0.5rem; }
	}
</style>
