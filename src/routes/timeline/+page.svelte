<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { loadWorldState, loadWorldBlocks } from '$lib/engine/world-loader';
	import { playerPrefs, loadPlayerPrefs } from '$lib/stores/player';

	// ── Collapse state ──────────────────────────────────────────────────────────
	let showOverview = $state(true);
	let showQuestlines = $state(true);
	let showCharacters = $state(false);
	let showLocations = $state(false);
	let showTimeline = $state(false);
	let showWorldFacts = $state(false);
	let showRecentEvents = $state(false);
	let showPlayerInfo = $state(false);

	let confirmClear = $state(false);

	// ── Load on mount ───────────────────────────────────────────────────────────
	onMount(() => {
		if (!$worldState) {
			const saved = loadWorldState();
			const blocks = loadWorldBlocks();
			if (saved) worldState.set(saved);
			if (blocks) worldBlocks.set(blocks);
		}
		const prefs = loadPlayerPrefs();
		playerPrefs.set(prefs);
	});

	function refresh() {
		const saved = loadWorldState();
		const blocks = loadWorldBlocks();
		worldState.set(saved);
		worldBlocks.set(blocks);
		const prefs = loadPlayerPrefs();
		playerPrefs.set(prefs);
		confirmClear = false;
	}

	function clearWorld() {
		if (!confirmClear) {
			confirmClear = true;
			return;
		}
		localStorage.removeItem('journal-rpg-world-state');
		localStorage.removeItem('journal-rpg-world-blocks');
		worldState.set(null);
		worldBlocks.set(null);
		confirmClear = false;
	}

	// ── Derived helpers ─────────────────────────────────────────────────────────
	let ws = $derived($worldState);
	let wb = $derived($worldBlocks);
	let prefs = $derived($playerPrefs);

	function formatDate(d: { year: number; season: string; day: number } | null | undefined): string {
		if (!d) return '—';
		return `Y${d.year} ${d.season.charAt(0).toUpperCase() + d.season.slice(1)}, Day ${d.day}`;
	}

	let sortedCharacters = $derived(
		ws
			? [...ws.characters].sort((a, b) => {
					if (a.alive !== b.alive) return a.alive ? -1 : 1;
					return a.name.localeCompare(b.name);
				})
			: []
	);

	let sortedTimeline = $derived(
		ws
			? [...ws.timeline].reverse()
			: []
	);

	function getCharacterName(id: string): string {
		return ws?.characters.find(c => c.id === id)?.name ?? id;
	}

	function getEventName(templateId: string): string {
		return wb?.events.find(e => e.id === templateId)?.name ?? templateId.replace(/_/g, ' ');
	}

	function getLocationName(id: string): string {
		return ws?.locations.find(l => l.id === id)?.name ?? id.replace(/_/g, ' ');
	}

	function getQuestlineName(id: string): string {
		return wb?.questlines.find(q => q.id === id)?.name ?? id.replace(/_/g, ' ');
	}

	function getQuestline(id: string) {
		return wb?.questlines.find(q => q.id === id) ?? null;
	}

	function valueType(v: unknown): string {
		if (typeof v === 'boolean') return 'bool';
		if (typeof v === 'number') return 'num';
		return 'str';
	}

	function axisBar(value: number): number {
		// Clamp -10..10 to 0..100%
		return Math.round(((Math.max(-10, Math.min(10, value)) + 10) / 20) * 100);
	}
</script>

<div class="inspector">
	<header class="inspector-header">
		<div class="header-left">
			<a href="{base}/" class="back-link">← Home</a>
			<h1 class="inspector-title">World Inspector</h1>
		</div>
		<div class="header-actions">
			<button class="action-btn" onclick={refresh}>Refresh</button>
			{#if confirmClear}
				<button class="action-btn danger" onclick={clearWorld}>Confirm Clear?</button>
				<button class="action-btn" onclick={() => (confirmClear = false)}>Cancel</button>
			{:else}
				<button class="action-btn danger-outline" onclick={clearWorld}>Clear World</button>
			{/if}
		</div>
	</header>

	{#if !ws}
		<div class="empty-state">
			<p>No world loaded.</p>
			<a href="{base}/" class="empty-link">Go to home to create or load a world.</a>
		</div>
	{:else}

	<!-- ── 1. WORLD OVERVIEW ──────────────────────────────────────────────────── -->
	<section class="section">
		<button class="section-header" onclick={() => (showOverview = !showOverview)}>
			<span class="section-title">World Overview</span>
			<span class="chevron">{showOverview ? '▾' : '▸'}</span>
		</button>
		{#if showOverview}
			<div class="section-body overview-grid">
				<div class="overview-main">
					<h2 class="world-name">{ws.config.name}</h2>
					<p class="world-setting">{ws.config.setting} &mdash; {ws.config.description}</p>
					<div class="date-system">
						<span class="label">Seasons:</span>
						<span>{ws.config.dateSystem.seasons.join(', ')}</span>
						<span class="label">Days/Season:</span>
						<span>{ws.config.dateSystem.daysPerSeason}</span>
						<span class="label">Start Year:</span>
						<span>{ws.config.dateSystem.startYear}</span>
					</div>
				</div>
				<div class="overview-stats">
					<div class="stat-card">
						<span class="stat-value">{ws.characters.filter(c => c.alive).length}</span>
						<span class="stat-label">Alive</span>
					</div>
					<div class="stat-card">
						<span class="stat-value">{ws.characters.length}</span>
						<span class="stat-label">Total Characters</span>
					</div>
					<div class="stat-card">
						<span class="stat-value">{ws.locations.length}</span>
						<span class="stat-label">Locations</span>
					</div>
					<div class="stat-card">
						<span class="stat-value">{ws.timeline.length}</span>
						<span class="stat-label">Timeline Entries</span>
					</div>
					<div class="stat-card">
						<span class="stat-value">{ws.questlineProgress.length}</span>
						<span class="stat-label">Active Questlines</span>
					</div>
				</div>
			</div>
		{/if}
	</section>

	<!-- ── 2. QUESTLINE PROGRESS ─────────────────────────────────────────────── -->
	<section class="section">
		<button class="section-header" onclick={() => (showQuestlines = !showQuestlines)}>
			<span class="section-title">Questline Progress</span>
			<span class="section-count">{ws.questlineProgress.length}</span>
			<span class="chevron">{showQuestlines ? '▾' : '▸'}</span>
		</button>
		{#if showQuestlines}
			<div class="section-body">
				{#if ws.questlineProgress.length === 0}
					<p class="empty-note">No active questlines.</p>
				{:else}
					{#each ws.questlineProgress as progress}
						{@const ql = getQuestline(progress.questlineId)}
						{@const stage = ql?.stages[progress.currentStageIndex]}
						<div class="quest-card">
							<div class="quest-header-row">
								<span class="quest-name">{getQuestlineName(progress.questlineId)}</span>
								<span class="quest-stage-badge">
									Stage {progress.currentStageIndex + 1} / {ql?.stages.length ?? '?'}
								</span>
							</div>

							<!-- Progress bar -->
							{#if ql}
								<div class="progress-track">
									{#each ql.stages as s, i}
										<div
											class="progress-pip {i < progress.currentStageIndex ? 'done' : i === progress.currentStageIndex ? 'active' : 'future'}"
											title={s.name}
										></div>
									{/each}
								</div>
							{/if}

							{#if stage}
								<p class="stage-name">{stage.name}</p>
								<p class="stage-desc">{stage.description}</p>
							{/if}

							{#if Object.keys(progress.counters).length > 0}
								<div class="counter-row">
									{#each Object.entries(progress.counters) as [key, val]}
										<span class="counter-badge">{key}: {val}</span>
									{/each}
								</div>
							{/if}

							{#if stage && (stage.advancementTriggers.length > 0 || stage.regressionTriggers.length > 0)}
								<div class="trigger-row">
									{#each stage.advancementTriggers as t}
										<span class="trigger-badge advance" title="Advancement trigger">
											↑ {t.key} ≥ {t.threshold}
										</span>
									{/each}
									{#each stage.regressionTriggers as t}
										<span class="trigger-badge regress" title="Regression trigger">
											↓ {t.key} ≥ {t.threshold}
										</span>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── 3. CHARACTERS ─────────────────────────────────────────────────────── -->
	<section class="section">
		<button class="section-header" onclick={() => (showCharacters = !showCharacters)}>
			<span class="section-title">Characters</span>
			<span class="section-count">{ws.characters.length}</span>
			<span class="chevron">{showCharacters ? '▾' : '▸'}</span>
		</button>
		{#if showCharacters}
			<div class="section-body character-grid">
				{#each sortedCharacters as char}
					<div class="char-card {char.alive ? '' : 'char-dead'}">
						<div class="char-header">
							<span class="char-name">{char.name}</span>
							<span class="char-status {char.alive ? 'alive' : 'dead'}">{char.alive ? 'Alive' : 'Dead'}</span>
						</div>
						<div class="char-meta">
							<span class="char-archetype">{char.archetypeId}</span>
							<span class="char-location">{getLocationName(char.locationId)}</span>
						</div>
						<div class="char-dates">
							<span class="label">Born:</span> {formatDate(char.birthDate)}
							{#if char.deathDate}
								<span class="label">Died:</span> {formatDate(char.deathDate)}
							{/if}
						</div>
						{#if char.parentId}
							<div class="char-parent">
								<span class="label">Parent:</span> {getCharacterName(char.parentId)}
							</div>
						{/if}

						<!-- Traits -->
						{#if Object.keys(char.traits).length > 0}
							<div class="badge-row">
								{#each Object.entries(char.traits) as [trait, val]}
									<span class="trait-badge">{trait.slice(0, 3).toUpperCase()} {val}</span>
								{/each}
							</div>
						{/if}

						<!-- Skills -->
						{#if char.skills.length > 0}
							<div class="badge-row">
								{#each char.skills as skill}
									<span class="skill-badge">{skill}</span>
								{/each}
							</div>
						{/if}

						<!-- Relationships -->
						{#if Object.keys(char.relationships).length > 0}
							<div class="rel-section">
								<span class="rel-header">Relationships</span>
								{#each Object.entries(char.relationships) as [targetId, rel]}
									<div class="rel-row">
										<span class="rel-name">{getCharacterName(targetId)}</span>
										{#if rel.tags.length > 0}
											<div class="badge-row inline">
												{#each rel.tags as tag}
													<span class="rel-tag">{tag}</span>
												{/each}
											</div>
										{/if}
										{#if Object.keys(rel.axes).length > 0}
											<div class="axis-list">
												{#each Object.entries(rel.axes) as [axis, val]}
													<div class="axis-row">
														<span class="axis-label">{axis}</span>
														<div class="axis-track">
															<div class="axis-fill" style="width: {axisBar(val)}%"></div>
														</div>
														<span class="axis-val">{val}</span>
													</div>
												{/each}
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
				{#if ws.characters.length === 0}
					<p class="empty-note">No characters yet.</p>
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── 4. LOCATIONS ──────────────────────────────────────────────────────── -->
	<section class="section">
		<button class="section-header" onclick={() => (showLocations = !showLocations)}>
			<span class="section-title">Locations</span>
			<span class="section-count">{ws.locations.length}</span>
			<span class="chevron">{showLocations ? '▾' : '▸'}</span>
		</button>
		{#if showLocations}
			<div class="section-body">
				{#if ws.locations.length === 0}
					<p class="empty-note">No locations.</p>
				{:else}
					<div class="location-grid">
						{#each ws.locations as loc}
							<div class="loc-card {loc.destroyedDate ? 'loc-destroyed' : ''}">
								<span class="loc-name {loc.destroyedDate ? 'strikethrough' : ''}">{loc.name}</span>
								<span class="loc-type">{loc.typeId}</span>
								<div class="loc-dates">
									<span class="label">Built:</span> {formatDate(loc.builtDate)}
									{#if loc.destroyedDate}
										<span class="label">Destroyed:</span> {formatDate(loc.destroyedDate)}
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── 5. TIMELINE ───────────────────────────────────────────────────────── -->
	<section class="section">
		<button class="section-header" onclick={() => (showTimeline = !showTimeline)}>
			<span class="section-title">Timeline</span>
			<span class="section-count">{ws.timeline.length}</span>
			<span class="chevron">{showTimeline ? '▾' : '▸'}</span>
		</button>
		{#if showTimeline}
			<div class="section-body">
				{#if sortedTimeline.length === 0}
					<p class="empty-note">No timeline entries yet.</p>
				{:else}
					<div class="timeline-list">
						{#each sortedTimeline as entry}
							<div class="timeline-entry">
								<div class="timeline-meta">
									<span class="timeline-date">{formatDate(entry.date)}</span>
									<span class="timeline-char">{getCharacterName(entry.characterId)}</span>
									<span class="timeline-event">{getEventName(entry.eventTemplateId)}</span>
								</div>
								<p class="timeline-summary">{entry.summary}</p>
								{#if entry.consequences.length > 0}
									<div class="badge-row">
										{#each entry.consequences as c}
											<span class="consequence-tag">{c.type}: {c.target}</span>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── 6. WORLD FACTS ────────────────────────────────────────────────────── -->
	<section class="section">
		<button class="section-header" onclick={() => (showWorldFacts = !showWorldFacts)}>
			<span class="section-title">World Facts</span>
			<span class="section-count">{Object.keys(ws.worldFacts).length}</span>
			<span class="chevron">{showWorldFacts ? '▾' : '▸'}</span>
		</button>
		{#if showWorldFacts}
			<div class="section-body">
				{#if Object.keys(ws.worldFacts).length === 0}
					<p class="empty-note">No world facts recorded.</p>
				{:else}
					<table class="facts-table">
						<thead>
							<tr>
								<th>Key</th>
								<th>Value</th>
								<th>Type</th>
							</tr>
						</thead>
						<tbody>
							{#each Object.entries(ws.worldFacts) as [key, val]}
								<tr>
									<td class="fact-key">{key}</td>
									<td class="fact-val">{String(val)}</td>
									<td><span class="type-badge type-{valueType(val)}">{valueType(val)}</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── 7. RECENT EVENTS ──────────────────────────────────────────────────── -->
	<section class="section">
		<button class="section-header" onclick={() => (showRecentEvents = !showRecentEvents)}>
			<span class="section-title">Recent Events (Staleness Tracker)</span>
			<span class="section-count">{ws.recentEventIds.length}</span>
			<span class="chevron">{showRecentEvents ? '▾' : '▸'}</span>
		</button>
		{#if showRecentEvents}
			<div class="section-body">
				{#if ws.recentEventIds.length === 0}
					<p class="empty-note">No recent events tracked.</p>
				{:else}
					<div class="badge-row">
						{#each ws.recentEventIds as eid}
							<span class="event-id-tag">{eid}</span>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</section>

	<!-- ── 8. PLAYER INFO ────────────────────────────────────────────────────── -->
	<section class="section">
		<button class="section-header" onclick={() => (showPlayerInfo = !showPlayerInfo)}>
			<span class="section-title">Player Info</span>
			<span class="chevron">{showPlayerInfo ? '▾' : '▸'}</span>
		</button>
		{#if showPlayerInfo}
			<div class="section-body">
				<div class="player-grid">
					<div class="player-row">
						<span class="label">LLM Setting:</span>
						<span class="player-val">{prefs.llmSetting}</span>
					</div>
					{#if prefs.llmEndpoint}
						<div class="player-row">
							<span class="label">LLM Endpoint:</span>
							<span class="player-val">{prefs.llmEndpoint}</span>
						</div>
					{/if}
					{#if prefs.llmModel}
						<div class="player-row">
							<span class="label">LLM Model:</span>
							<span class="player-val">{prefs.llmModel}</span>
						</div>
					{/if}
					<div class="player-row">
						<span class="label">Played Characters:</span>
						<span class="player-val">
							{#if ws.playedCharacterIds.length === 0}
								None
							{:else}
								{ws.playedCharacterIds.map(id => getCharacterName(id)).join(', ')}
							{/if}
						</span>
					</div>
				</div>
			</div>
		{/if}
	</section>

	{/if}
</div>

<style>
	/* ── Layout ─────────────────────────────────────────────────────────────── */
	.inspector {
		min-height: 100vh;
		background-color: var(--session-end-bg);
		color: var(--session-end-text);
		padding: 1.5rem;
		font-family: var(--journal-font);
	}

	.inspector-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 2rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid var(--session-end-border);
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}

	.back-link {
		color: var(--session-end-text);
		opacity: 0.5;
		text-decoration: none;
		font-size: 0.85rem;
		letter-spacing: 0.04em;
		transition: opacity 0.15s;
	}

	.back-link:hover { opacity: 0.9; }

	.inspector-title {
		font-size: 1.5rem;
		color: var(--journal-accent);
		letter-spacing: 0.05em;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* ── Buttons ────────────────────────────────────────────────────────────── */
	.action-btn {
		background: var(--session-end-card-bg);
		color: var(--session-end-text);
		border: 1px solid var(--session-end-border);
		border-radius: 4px;
		padding: 0.3rem 0.75rem;
		font-size: 0.8rem;
		cursor: pointer;
		letter-spacing: 0.05em;
		transition: background 0.15s, border-color 0.15s;
	}

	.action-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: var(--journal-accent);
	}

	.action-btn.danger {
		border-color: #c06060;
		color: #e88888;
	}

	.action-btn.danger:hover {
		background: rgba(200, 80, 80, 0.2);
	}

	.action-btn.danger-outline {
		border-color: rgba(200, 80, 80, 0.35);
		color: rgba(232, 136, 136, 0.55);
	}

	.action-btn.danger-outline:hover {
		border-color: #c06060;
		color: #e88888;
	}

	/* ── Empty state ────────────────────────────────────────────────────────── */
	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		opacity: 0.6;
	}

	.empty-state p {
		font-size: 1.1rem;
		margin-bottom: 0.75rem;
	}

	.empty-link {
		color: var(--journal-accent);
		text-decoration: none;
		font-size: 0.9rem;
	}

	.empty-link:hover { text-decoration: underline; }

	.empty-note {
		font-size: 0.85rem;
		opacity: 0.5;
		font-style: italic;
		padding: 0.5rem 0;
	}

	/* ── Sections ───────────────────────────────────────────────────────────── */
	.section {
		margin-bottom: 0.75rem;
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.section-header {
		width: 100%;
		background: var(--session-end-card-bg);
		color: var(--session-end-text);
		border: none;
		padding: 0.75rem 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		text-align: left;
		font-family: var(--journal-font);
		font-size: 0.95rem;
		letter-spacing: 0.04em;
		transition: background 0.15s;
	}

	.section-header:hover {
		background: rgba(255, 255, 255, 0.07);
	}

	.section-title {
		flex: 1;
		font-weight: 600;
		color: var(--journal-accent);
	}

	.section-count {
		font-size: 0.75rem;
		background: rgba(255, 255, 255, 0.1);
		padding: 0.1rem 0.45rem;
		border-radius: 10px;
		opacity: 0.7;
	}

	.chevron {
		opacity: 0.5;
		font-size: 0.8rem;
	}

	.section-body {
		padding: 1rem;
		background: transparent;
	}

	/* ── Overview ───────────────────────────────────────────────────────────── */
	.overview-grid {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 1.5rem;
		align-items: start;
	}

	@media (max-width: 600px) {
		.overview-grid { grid-template-columns: 1fr; }
	}

	.world-name {
		font-size: 1.4rem;
		color: var(--journal-accent);
		margin-bottom: 0.25rem;
	}

	.world-setting {
		font-size: 0.9rem;
		opacity: 0.7;
		margin-bottom: 0.75rem;
		font-style: italic;
	}

	.date-system {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
		font-size: 0.8rem;
		opacity: 0.7;
	}

	.label {
		font-size: 0.75rem;
		opacity: 0.55;
		letter-spacing: 0.03em;
	}

	.overview-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.stat-card {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 0.5rem 0.85rem;
		text-align: center;
		min-width: 80px;
	}

	.stat-value {
		display: block;
		font-size: 1.6rem;
		color: var(--journal-accent);
		font-weight: 600;
		line-height: 1;
	}

	.stat-label {
		display: block;
		font-size: 0.65rem;
		opacity: 0.55;
		margin-top: 0.2rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	/* ── Questlines ─────────────────────────────────────────────────────────── */
	.quest-card {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 0.85rem 1rem;
		margin-bottom: 0.75rem;
	}

	.quest-header-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 0.5rem;
		gap: 0.5rem;
	}

	.quest-name {
		font-size: 1rem;
		color: var(--journal-accent);
		font-weight: 600;
	}

	.quest-stage-badge {
		font-size: 0.7rem;
		background: rgba(255, 255, 255, 0.08);
		padding: 0.15rem 0.5rem;
		border-radius: 10px;
		opacity: 0.7;
		white-space: nowrap;
	}

	.progress-track {
		display: flex;
		gap: 4px;
		margin-bottom: 0.6rem;
	}

	.progress-pip {
		height: 6px;
		flex: 1;
		border-radius: 3px;
	}

	.progress-pip.done { background: var(--journal-accent); opacity: 0.5; }
	.progress-pip.active { background: var(--journal-accent); }
	.progress-pip.future { background: rgba(255, 255, 255, 0.1); }

	.stage-name {
		font-size: 0.9rem;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.stage-desc {
		font-size: 0.85rem;
		opacity: 0.7;
		margin-bottom: 0.5rem;
		font-style: italic;
	}

	.counter-row, .trigger-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.4rem;
	}

	.counter-badge {
		font-size: 0.72rem;
		padding: 0.1rem 0.45rem;
		background: rgba(139, 105, 20, 0.25);
		border: 1px solid rgba(139, 105, 20, 0.4);
		border-radius: 10px;
		color: var(--journal-accent);
	}

	.trigger-badge {
		font-size: 0.7rem;
		padding: 0.1rem 0.4rem;
		border-radius: 10px;
	}

	.trigger-badge.advance {
		background: rgba(80, 160, 80, 0.2);
		border: 1px solid rgba(80, 160, 80, 0.4);
		color: #88cc88;
	}

	.trigger-badge.regress {
		background: rgba(200, 80, 80, 0.2);
		border: 1px solid rgba(200, 80, 80, 0.35);
		color: #e88888;
	}

	/* ── Characters ─────────────────────────────────────────────────────────── */
	.character-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 0.75rem;
	}

	.char-card {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 0.85rem 1rem;
	}

	.char-dead {
		opacity: 0.45;
	}

	.char-header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 0.3rem;
	}

	.char-name {
		font-size: 1rem;
		font-weight: 600;
		color: var(--session-end-text);
	}

	.char-status {
		font-size: 0.7rem;
		padding: 0.1rem 0.45rem;
		border-radius: 10px;
		letter-spacing: 0.05em;
	}

	.char-status.alive {
		background: rgba(80, 160, 80, 0.2);
		border: 1px solid rgba(80, 160, 80, 0.4);
		color: #88cc88;
	}

	.char-status.dead {
		background: rgba(200, 80, 80, 0.15);
		border: 1px solid rgba(200, 80, 80, 0.3);
		color: #e88888;
	}

	.char-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.78rem;
		opacity: 0.6;
		margin-bottom: 0.4rem;
	}

	.char-archetype::before { content: 'Class: '; opacity: 0.7; }
	.char-location::before { content: 'At: '; opacity: 0.7; }

	.char-dates, .char-parent {
		font-size: 0.75rem;
		opacity: 0.6;
		margin-bottom: 0.35rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.6rem;
	}

	/* ── Badges ─────────────────────────────────────────────────────────────── */
	.badge-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.35rem;
	}

	.badge-row.inline {
		margin-top: 0.15rem;
	}

	.trait-badge {
		font-size: 0.68rem;
		padding: 0.1rem 0.4rem;
		background: rgba(139, 105, 20, 0.2);
		border: 1px solid rgba(139, 105, 20, 0.35);
		border-radius: 3px;
		color: var(--journal-accent);
		font-family: 'Courier New', monospace;
		letter-spacing: 0.03em;
	}

	.skill-badge {
		font-size: 0.68rem;
		padding: 0.1rem 0.4rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--session-end-border);
		border-radius: 3px;
		opacity: 0.75;
	}

	/* ── Relationships ──────────────────────────────────────────────────────── */
	.rel-section {
		margin-top: 0.6rem;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(255, 255, 255, 0.07);
	}

	.rel-header {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		opacity: 0.45;
		display: block;
		margin-bottom: 0.35rem;
	}

	.rel-row {
		margin-bottom: 0.45rem;
	}

	.rel-name {
		font-size: 0.8rem;
		font-weight: 600;
		opacity: 0.85;
	}

	.rel-tag {
		font-size: 0.65rem;
		padding: 0.08rem 0.35rem;
		background: rgba(100, 100, 200, 0.2);
		border: 1px solid rgba(100, 100, 200, 0.35);
		border-radius: 10px;
		color: #a0a0e8;
	}

	.axis-list {
		margin-top: 0.25rem;
	}

	.axis-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.2rem;
	}

	.axis-label {
		font-size: 0.68rem;
		opacity: 0.6;
		width: 70px;
		flex-shrink: 0;
	}

	.axis-track {
		flex: 1;
		height: 4px;
		background: rgba(255, 255, 255, 0.1);
		border-radius: 2px;
		overflow: hidden;
	}

	.axis-fill {
		height: 100%;
		background: var(--journal-accent);
		border-radius: 2px;
		transition: width 0.2s;
	}

	.axis-val {
		font-size: 0.68rem;
		opacity: 0.6;
		width: 24px;
		text-align: right;
		font-family: 'Courier New', monospace;
	}

	/* ── Locations ──────────────────────────────────────────────────────────── */
	.location-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.6rem;
	}

	.loc-card {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 0.65rem 0.85rem;
	}

	.loc-destroyed {
		opacity: 0.4;
	}

	.loc-name {
		display: block;
		font-size: 0.9rem;
		font-weight: 600;
		margin-bottom: 0.15rem;
	}

	.strikethrough {
		text-decoration: line-through;
	}

	.loc-type {
		display: block;
		font-size: 0.72rem;
		opacity: 0.5;
		margin-bottom: 0.3rem;
		letter-spacing: 0.03em;
	}

	.loc-dates {
		font-size: 0.72rem;
		opacity: 0.55;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.55rem;
	}

	/* ── Timeline ───────────────────────────────────────────────────────────── */
	.timeline-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.timeline-entry {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-left: 3px solid var(--journal-accent);
		border-radius: 4px;
		padding: 0.65rem 0.85rem;
	}

	.timeline-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.85rem;
		margin-bottom: 0.3rem;
		font-size: 0.75rem;
	}

	.timeline-date { opacity: 0.55; }
	.timeline-char { color: var(--journal-accent); font-weight: 600; }
	.timeline-event { opacity: 0.75; font-style: italic; }

	.timeline-summary {
		font-size: 0.85rem;
		opacity: 0.85;
		line-height: 1.5;
		margin-bottom: 0.3rem;
	}

	.consequence-tag {
		font-size: 0.65rem;
		padding: 0.08rem 0.35rem;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--session-end-border);
		border-radius: 3px;
		opacity: 0.65;
		font-family: 'Courier New', monospace;
	}

	/* ── World Facts ────────────────────────────────────────────────────────── */
	.facts-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.facts-table th {
		text-align: left;
		padding: 0.4rem 0.75rem;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		opacity: 0.45;
		border-bottom: 1px solid var(--session-end-border);
	}

	.facts-table td {
		padding: 0.4rem 0.75rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
		vertical-align: middle;
	}

	.fact-key {
		font-family: 'Courier New', monospace;
		color: var(--journal-accent);
		font-size: 0.8rem;
	}

	.fact-val {
		opacity: 0.8;
	}

	.type-badge {
		font-size: 0.65rem;
		padding: 0.08rem 0.4rem;
		border-radius: 3px;
		font-family: 'Courier New', monospace;
		letter-spacing: 0.03em;
	}

	.type-bool {
		background: rgba(100, 160, 100, 0.2);
		border: 1px solid rgba(100, 160, 100, 0.35);
		color: #88cc88;
	}

	.type-num {
		background: rgba(100, 100, 200, 0.2);
		border: 1px solid rgba(100, 100, 200, 0.35);
		color: #a0a0e8;
	}

	.type-str {
		background: rgba(200, 160, 80, 0.2);
		border: 1px solid rgba(200, 160, 80, 0.35);
		color: #d4a850;
	}

	/* ── Recent events ──────────────────────────────────────────────────────── */
	.event-id-tag {
		font-size: 0.7rem;
		padding: 0.1rem 0.45rem;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid var(--session-end-border);
		border-radius: 3px;
		font-family: 'Courier New', monospace;
		opacity: 0.65;
	}

	/* ── Player info ────────────────────────────────────────────────────────── */
	.player-grid {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.player-row {
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
		font-size: 0.85rem;
	}

	.player-val {
		opacity: 0.8;
	}

	@media (max-width: 480px) {
		.inspector {
			padding: 1rem 0.75rem;
		}

		.inspector-header {
			flex-direction: column;
			align-items: flex-start;
		}

		.header-left {
			flex-direction: column;
			gap: 0.35rem;
		}

		.header-actions {
			flex-wrap: wrap;
		}

		.character-grid {
			grid-template-columns: 1fr;
		}

		.location-grid {
			grid-template-columns: 1fr;
		}

		.facts-table {
			display: block;
			overflow-x: auto;
			white-space: nowrap;
		}
	}
</style>
