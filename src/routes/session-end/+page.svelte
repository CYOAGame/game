<script lang="ts">
	import { goto } from '$app/navigation';
	import { worldState } from '$lib/stores/world';
	import { playSession } from '$lib/stores/session';
	import { saveWorldState, loadWorldState } from '$lib/engine/world-loader';

	// Derived from stores
	let session = $derived($playSession);
	let state = $derived($worldState);

	let currentCharacter = $derived(
		session && state ? state.characters.find(c => c.id === session!.characterId) ?? null : null
	);

	let choiceCount = $derived(session ? session.choiceLog.length : 0);

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
		return `${choiceCount} ${choiceCount === 1 ? 'choice' : 'choices'} were made this entry.`;
	});

	let dateDisplay = $derived((): string => {
		if (!session || !state) return '';
		const season = session.date.season;
		const seasonCapitalized = season.charAt(0).toUpperCase() + season.slice(1);
		return `${seasonCapitalized}, Year ${session.date.year}, Day ${session.date.day}`;
	});

	function handleSave() {
		if (!state) return;
		saveWorldState(state);
		playSession.set(null);
		goto('/journal');
	}

	function handleDiscardReplay() {
		const saved = loadWorldState();
		if (saved) {
			worldState.set(saved);
		}
		playSession.set(null);
		goto('/journal');
	}

	function handleDiscardMenu() {
		const saved = loadWorldState();
		if (saved) {
			worldState.set(saved);
		}
		playSession.set(null);
		goto('/');
	}
</script>

<div class="session-end-page">
	<!-- Header -->
	<header class="session-end-header">
		<a href="/" class="back-link">← Home</a>
		<h1 class="page-title">Journal Entry Complete</h1>
		<span class="spacer"></span>
	</header>

	<!-- Main content -->
	<main class="session-end-main">
		<div class="entry-card">
			<!-- Character & date -->
			<div class="entry-identity">
				<h2 class="character-name">
					{currentCharacter?.name ?? 'Unknown Character'}
				</h2>
				<span class="entry-date">{dateDisplay()}</span>
			</div>

			<!-- Summary section -->
			<section class="summary-section">
				<h3 class="section-label">What happened</h3>
				<p class="summary-text">{sessionSummary()}</p>

				{#if session?.isDead}
					<div class="death-notice">
						<span class="death-icon">✦</span>
						<span>This character's story has ended.</span>
					</div>
				{/if}
			</section>

			<!-- Choice tags -->
			{#if choiceTags().length > 0}
				<section class="tags-section">
					<h3 class="section-label">This entry touched on</h3>
					<div class="tags-list">
						{#each choiceTags() as tag}
							<span class="tag">{tag}</span>
						{/each}
					</div>
				</section>
			{/if}

			<div class="divider"></div>

			<!-- This entry: action buttons -->
			<section class="actions-section">
				<h3 class="section-label">This entry</h3>
				<div class="action-buttons">
					<button class="btn btn-save" onclick={handleSave}>
						<span class="btn-title">Save</span>
						<span class="btn-sub">Keep changes and continue</span>
					</button>
					<button class="btn btn-discard" onclick={handleDiscardReplay}>
						<span class="btn-title">Discard &amp; Replay</span>
						<span class="btn-sub">Reload last save, redo this entry</span>
					</button>
					<button class="btn btn-discard-menu" onclick={handleDiscardMenu}>
						<span class="btn-title">Discard &amp; Return to Menu</span>
						<span class="btn-sub">Reload last save, go to menu</span>
					</button>
				</div>
			</section>

			<div class="divider"></div>

			<!-- Next entry: Phase 2 deferred buttons -->
			<section class="actions-section next-entry-section">
				<h3 class="section-label">
					Next entry
					<span class="coming-soon-note">— coming in Phase 2</span>
				</h3>
				<div class="action-buttons">
					<button class="btn btn-next-entry" disabled>
						<span class="btn-title">Past</span>
						<span class="btn-sub">Revisit an earlier moment</span>
					</button>
					<button class="btn btn-next-entry" disabled>
						<span class="btn-title">Future</span>
						<span class="btn-sub">Jump forward in time</span>
					</button>
					<button class="btn btn-next-entry" disabled>
						<span class="btn-title">Someone Else</span>
						<span class="btn-sub">Play a different character</span>
					</button>
				</div>
			</section>
		</div>
	</main>
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

	/* Header */
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

	.back-link:hover {
		opacity: 1;
	}

	.page-title {
		font-size: 1.1rem;
		font-weight: normal;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		opacity: 0.7;
		text-align: center;
		flex: 2;
	}

	.spacer {
		flex: 1;
	}

	/* Main area */
	.session-end-main {
		flex: 1;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: 2.5rem 1rem;
	}

	.entry-card {
		width: 100%;
		max-width: 640px;
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 2.5rem 2.5rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
	}

	/* Identity block */
	.entry-identity {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.character-name {
		font-size: 1.8rem;
		font-weight: normal;
		color: var(--journal-accent);
		letter-spacing: 0.02em;
	}

	.entry-date {
		font-size: 0.85rem;
		opacity: 0.5;
		letter-spacing: 0.06em;
	}

	/* Section labels */
	.section-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		opacity: 0.45;
		font-weight: normal;
		margin-bottom: 0.6rem;
	}

	.coming-soon-note {
		font-size: 0.7rem;
		opacity: 0.6;
		letter-spacing: 0.05em;
		text-transform: none;
	}

	/* Summary */
	.summary-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.summary-text {
		font-size: 1rem;
		line-height: 1.75;
		opacity: 0.85;
	}

	.death-notice {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.9rem;
		color: #c07060;
		margin-top: 0.25rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid rgba(192, 112, 96, 0.3);
		border-radius: 4px;
		background: rgba(192, 112, 96, 0.07);
	}

	.death-icon {
		font-size: 0.7rem;
		opacity: 0.75;
	}

	/* Tags */
	.tags-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tags-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.tag {
		padding: 0.25rem 0.65rem;
		background: rgba(255, 255, 255, 0.07);
		border: 1px solid var(--session-end-border);
		border-radius: 20px;
		font-size: 0.8rem;
		opacity: 0.75;
		letter-spacing: 0.03em;
	}

	/* Divider */
	.divider {
		height: 1px;
		background: var(--session-end-border);
		opacity: 0.5;
	}

	/* Action sections */
	.actions-section {
		display: flex;
		flex-direction: column;
	}

	.action-buttons {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* Buttons */
	.btn {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding: 0.75rem 1rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--session-end-border);
		border-radius: 4px;
		cursor: pointer;
		font-family: var(--journal-font);
		color: var(--session-end-text);
		text-align: left;
		transition: background 0.15s, border-color 0.15s, transform 0.1s;
		gap: 0.15rem;
		width: 100%;
	}

	.btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.08);
		border-color: rgba(255, 255, 255, 0.2);
		transform: translateX(2px);
	}

	.btn:active:not(:disabled) {
		transform: translateX(0);
	}

	.btn-title {
		font-size: 0.95rem;
		letter-spacing: 0.02em;
	}

	.btn-sub {
		font-size: 0.75rem;
		opacity: 0.45;
	}

	/* Save button — highlighted */
	.btn-save {
		border-color: rgba(139, 105, 20, 0.5);
		background: rgba(139, 105, 20, 0.1);
	}

	.btn-save:hover {
		background: rgba(139, 105, 20, 0.2) !important;
		border-color: var(--journal-accent) !important;
	}

	.btn-save .btn-title {
		color: var(--journal-accent);
	}

	/* Discard buttons */
	.btn-discard,
	.btn-discard-menu {
		opacity: 0.75;
	}

	.btn-discard:hover,
	.btn-discard-menu:hover {
		opacity: 1;
	}

	/* Next entry — disabled state */
	.next-entry-section .action-buttons {
		flex-direction: row;
		flex-wrap: wrap;
	}

	.btn-next-entry {
		flex: 1;
		min-width: 140px;
		cursor: not-allowed;
		opacity: 0.3;
	}

	.btn-next-entry:disabled {
		opacity: 0.3;
		background: rgba(255, 255, 255, 0.02);
		border-color: rgba(74, 74, 58, 0.4);
		transform: none;
	}

	/* Responsive */
	@media (max-width: 520px) {
		.entry-card {
			padding: 1.75rem 1.25rem;
		}

		.next-entry-section .action-buttons {
			flex-direction: column;
		}
	}
</style>
