<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { playerPrefs, loadPlayerPrefs, savePlayerPrefs } from '$lib/stores/player';
	import { enhanceText, type LLMContext } from '$lib/engine/llm-adapter';
	import type { PlayerPrefs } from '$lib/stores/player';
	import { githubState, clearAuth } from '$lib/stores/github';
	import { commitFiles, getPendingChanges } from '$lib/git/repo-writer';
	import { AuthExpiredError } from '$lib/git/auth-errors';

	let prefs = $state<PlayerPrefs>({
		dayTypePreferences: [],
		llmSetting: 'none',
		llmEndpoint: 'http://localhost:11434/v1',
		llmModel: '',
		llmApiKey: ''
	});

	let testStatus = $state<'idle' | 'testing' | 'success' | 'error'>('idle');
	let testMessage = $state('');
	let saveStatus = $state<'idle' | 'saved'>('idle');

	onMount(() => {
		const loaded = loadPlayerPrefs();
		prefs = {
			...loaded,
			llmEndpoint: loaded.llmEndpoint ?? 'http://localhost:11434/v1',
			llmModel: loaded.llmModel ?? '',
			llmApiKey: loaded.llmApiKey ?? ''
		};
	});

	function selectMode(mode: 'none' | 'local' | 'claude') {
		prefs = { ...prefs, llmSetting: mode };
		testStatus = 'idle';
		testMessage = '';
	}

	async function testConnection() {
		testStatus = 'testing';
		testMessage = '';

		const testContext: LLMContext = {
			characterName: 'Elena',
			characterArchetype: 'blacksmith',
			season: 'spring',
			timeContext: 'present'
		};

		const original = 'The forge burns hot today.';

		try {
			const result = await enhanceText(original, testContext, prefs);
			if (result !== original) {
				testStatus = 'success';
				testMessage = `Connection successful. Sample: "${result.slice(0, 80)}${result.length > 80 ? '...' : ''}"`;
			} else {
				testStatus = 'error';
				testMessage = 'LLM returned the original text unchanged. Check browser console for details.';
			}
		} catch (err: any) {
			testStatus = 'error';
			testMessage = `Connection failed: ${err?.message ?? 'Unknown error'}. Check browser console.`;
		}
	}

	function handleSave() {
		savePlayerPrefs(prefs);
		playerPrefs.set(prefs);
		saveStatus = 'saved';
		setTimeout(() => { saveStatus = 'idle'; }, 2000);
	}

	// GitHub section
	let ghState = $derived($githubState);
	let syncNowStatus = $state<'idle' | 'syncing' | 'done' | 'error'>('idle');
	let syncNowMessage = $state('');

	async function handleSyncNow() {
		syncNowStatus = 'syncing';
		syncNowMessage = '';
		try {
			const pending = getPendingChanges();
			if (pending.length === 0) {
				syncNowStatus = 'done';
				syncNowMessage = 'Nothing pending to sync.';
				return;
			}
			for (const batch of pending) {
				const files = new Map(Object.entries(batch.files));
				const result = await commitFiles(ghState.token, ghState.repoOwner, ghState.repoName, files, batch.message);
				if (!result.success) {
					syncNowStatus = 'error';
					syncNowMessage = result.error ?? 'Sync failed.';
					return;
				}
			}
			githubState.update(s => ({ ...s, syncStatus: 'synced' }));
			syncNowStatus = 'done';
			syncNowMessage = `Synced ${pending.length} pending ${pending.length === 1 ? 'batch' : 'batches'}.`;
		} catch (err: any) {
			if (err instanceof AuthExpiredError) {
				goto(`${base}/login?error=expired`);
				return;
			}
			syncNowStatus = 'error';
			syncNowMessage = err?.message ?? 'Sync failed.';
		}
	}

	function handleDisconnect() {
		const current = loadPlayerPrefs();
		savePlayerPrefs({ ...current, repoOwner: undefined, repoName: undefined });
		playerPrefs.update(p => ({ ...p, repoOwner: undefined, repoName: undefined }));
		clearAuth();
	}
</script>

<div class="settings-page">
	<div class="settings-inner">
		<header class="settings-header">
			<a href="{base}/" class="back-link">&larr; Back</a>
			<h1 class="settings-title">Settings</h1>
		</header>

		<section class="setting-section">
			<h2 class="section-title">Narrative Enhancement</h2>
			<p class="section-desc">
				Connect an LLM to get richer prose for journal entries. The game works fully without one — this is purely cosmetic.
			</p>

			<div class="mode-selector">
				<button
					class="mode-btn"
					class:mode-btn-active={prefs.llmSetting === 'none'}
					onclick={() => selectMode('none')}
				>
					None
				</button>
				<button
					class="mode-btn"
					class:mode-btn-active={prefs.llmSetting === 'local'}
					onclick={() => selectMode('local')}
				>
					Local LLM
				</button>
				<button
					class="mode-btn"
					class:mode-btn-active={prefs.llmSetting === 'claude'}
					onclick={() => selectMode('claude')}
				>
					Claude API
				</button>
			</div>

			{#if prefs.llmSetting === 'none'}
				<p class="mode-hint">Template text will be used as-is. No external calls.</p>
			{/if}

			{#if prefs.llmSetting === 'local'}
				<div class="field-group">
					<label class="field-label" for="endpoint">Endpoint URL</label>
					<p class="field-hint">Ollama default: <code>http://localhost:11434/v1</code> — LM Studio: <code>http://localhost:1234/v1</code></p>
					<input
						id="endpoint"
						class="field-input"
						type="text"
						bind:value={prefs.llmEndpoint}
						placeholder="http://localhost:11434/v1"
					/>
				</div>
				<div class="field-group">
					<label class="field-label" for="model">Model Name <span style="opacity: 0.5;">(optional)</span></label>
					<p class="field-hint">Leave blank to auto-detect. Examples: <code>gemma3:1b</code>, <code>llama3.2:3b</code></p>
					<input
						id="model"
						class="field-input"
						type="text"
						bind:value={prefs.llmModel}
						placeholder="auto-detect"
					/>
				</div>
				<button
					class="test-btn"
					disabled={testStatus === 'testing'}
					onclick={testConnection}
				>
					{testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
				</button>
			{/if}

			{#if prefs.llmSetting === 'claude'}
				<div class="field-group">
					<label class="field-label" for="apikey">Claude API Key</label>
					<p class="field-hint">Your key is stored in localStorage and never sent anywhere except Anthropic's API.</p>
					<input
						id="apikey"
						class="field-input"
						type="password"
						bind:value={prefs.llmApiKey}
						placeholder="sk-ant-..."
					/>
				</div>
				<button
					class="test-btn"
					disabled={testStatus === 'testing'}
					onclick={testConnection}
				>
					{testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
				</button>
			{/if}

			{#if testStatus === 'success'}
				<p class="test-result test-success">{testMessage}</p>
			{:else if testStatus === 'error'}
				<p class="test-result test-error">{testMessage}</p>
			{/if}
		</section>

		<!-- GitHub Connection Section -->
		<section class="setting-section">
			<h2 class="section-title">GitHub Connection</h2>
			{#if ghState.isAuthenticated}
				<div class="gh-info-row">
					<span class="gh-label">Account</span>
					<span class="gh-value">{ghState.username}</span>
				</div>
				{#if ghState.isConnected}
					<div class="gh-info-row">
						<span class="gh-label">World Repo</span>
						<span class="gh-value gh-repo">{ghState.repoOwner}/{ghState.repoName}</span>
					</div>
					<div class="gh-info-row">
						<span class="gh-label">Sync Status</span>
						<span class="gh-value gh-sync-{ghState.syncStatus}">
							{#if ghState.syncStatus === 'synced'}Synced
							{:else if ghState.syncStatus === 'syncing'}Syncing...
							{:else if ghState.syncStatus === 'pending'}Pending
							{:else if ghState.syncStatus === 'error'}Error{#if ghState.syncError} — {ghState.syncError}{/if}
							{:else}Idle{/if}
						</span>
					</div>
				{/if}
				<div class="gh-actions">
					{#if ghState.isConnected}
						<button
							class="test-btn"
							disabled={syncNowStatus === 'syncing'}
							onclick={handleSyncNow}
						>
							{syncNowStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
						</button>
					{/if}
					<button class="test-btn gh-disconnect-btn" onclick={handleDisconnect}>
						Disconnect
					</button>
				</div>
				{#if syncNowStatus === 'done'}
					<p class="test-result test-success">{syncNowMessage}</p>
				{:else if syncNowStatus === 'error'}
					<p class="test-result test-error">{syncNowMessage}</p>
				{/if}
			{:else}
				<p class="section-desc">Not connected. <a href="{base}/login" class="gh-link">Login with GitHub</a> to sync your world.</p>
			{/if}
		</section>

		<div class="save-row">
			<button class="save-btn" onclick={handleSave}>
				{saveStatus === 'saved' ? 'Saved!' : 'Save Settings'}
			</button>
		</div>
	</div>
</div>

<style>
	.settings-page {
		min-height: 100vh;
		background-color: var(--session-end-bg);
		color: var(--session-end-text);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 2rem 1rem;
		font-family: var(--journal-font);
	}

	.settings-inner {
		width: 100%;
		max-width: 560px;
	}

	.settings-header {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		margin-bottom: 2.5rem;
	}

	.back-link {
		color: var(--journal-accent);
		text-decoration: none;
		font-size: 0.9rem;
		opacity: 0.8;
		white-space: nowrap;
	}

	.back-link:hover {
		opacity: 1;
	}

	.settings-title {
		font-size: 2rem;
		color: var(--journal-accent);
		margin: 0;
		letter-spacing: 0.04em;
	}

	.setting-section {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.section-title {
		font-size: 1.1rem;
		color: var(--session-end-text);
		margin: 0 0 0.5rem 0;
		letter-spacing: 0.03em;
	}

	.section-desc {
		font-size: 0.88rem;
		color: var(--session-end-text);
		opacity: 0.65;
		line-height: 1.6;
		margin: 0 0 1.25rem 0;
	}

	/* Mode selector — toggle-button row */
	.mode-selector {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
		flex-wrap: wrap;
	}

	.mode-btn {
		padding: 0.45rem 1.1rem;
		background: transparent;
		border: 1px solid var(--session-end-border);
		border-radius: 4px;
		color: var(--session-end-text);
		font-family: var(--journal-font);
		font-size: 0.9rem;
		cursor: pointer;
		opacity: 0.65;
		transition: opacity 0.15s, border-color 0.15s, background 0.15s;
	}

	.mode-btn:hover {
		opacity: 0.9;
	}

	.mode-btn-active {
		background: var(--journal-accent);
		border-color: var(--journal-accent);
		color: #fff8ee;
		opacity: 1;
	}

	.mode-hint {
		font-size: 0.85rem;
		color: var(--session-end-text);
		opacity: 0.5;
		font-style: italic;
		margin: 0;
	}

	/* Field */
	.field-group {
		margin-bottom: 1rem;
	}

	.field-label {
		display: block;
		font-size: 0.85rem;
		color: var(--session-end-text);
		opacity: 0.75;
		margin-bottom: 0.3rem;
		letter-spacing: 0.03em;
	}

	.field-hint {
		font-size: 0.78rem;
		color: var(--session-end-text);
		opacity: 0.45;
		margin: 0 0 0.4rem 0;
		line-height: 1.5;
	}

	.field-hint code {
		font-family: monospace;
		background: rgba(255,255,255,0.07);
		padding: 0.1em 0.3em;
		border-radius: 2px;
	}

	.field-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.55rem 0.75rem;
		background: rgba(255,255,255,0.06);
		border: 1px solid var(--session-end-border);
		border-radius: 4px;
		color: var(--session-end-text);
		font-family: monospace;
		font-size: 0.88rem;
	}

	.field-input:focus {
		outline: none;
		border-color: var(--journal-accent);
	}

	/* Test button */
	.test-btn {
		padding: 0.45rem 1.25rem;
		background: transparent;
		border: 1px solid var(--session-end-border);
		border-radius: 4px;
		color: var(--session-end-text);
		font-family: var(--journal-font);
		font-size: 0.88rem;
		cursor: pointer;
		opacity: 0.75;
		transition: opacity 0.15s;
		margin-bottom: 0.75rem;
	}

	.test-btn:hover:not(:disabled) {
		opacity: 1;
		border-color: var(--journal-accent);
	}

	.test-btn:disabled {
		cursor: default;
		opacity: 0.45;
	}

	.test-result {
		font-size: 0.85rem;
		line-height: 1.5;
		margin: 0;
		padding: 0.6rem 0.85rem;
		border-radius: 4px;
	}

	.test-success {
		background: rgba(80, 160, 80, 0.15);
		border: 1px solid rgba(80, 160, 80, 0.4);
		color: #8ecf8e;
	}

	.test-error {
		background: rgba(180, 60, 60, 0.15);
		border: 1px solid rgba(180, 60, 60, 0.4);
		color: #e09090;
	}

	/* Save row */
	.save-row {
		display: flex;
		justify-content: flex-end;
	}

	.save-btn {
		padding: 0.65rem 2rem;
		background: var(--journal-accent);
		border: none;
		border-radius: 4px;
		color: #fff8ee;
		font-family: var(--journal-font);
		font-size: 0.95rem;
		cursor: pointer;
		transition: opacity 0.15s;
		min-width: 140px;
	}

	.save-btn:hover {
		opacity: 0.88;
	}

	/* GitHub section */
	.gh-info-row {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.gh-label {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.45;
		min-width: 90px;
	}

	.gh-value {
		font-size: 0.88rem;
		opacity: 0.85;
	}

	.gh-repo {
		font-family: monospace;
		color: var(--journal-accent);
	}

	.gh-sync-synced { color: #8ecf8e; }
	.gh-sync-syncing { color: #9ab8e8; }
	.gh-sync-pending { color: #d4b96a; }
	.gh-sync-error { color: #e09090; }
	.gh-sync-idle { opacity: 0.5; }

	.gh-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}

	.gh-disconnect-btn {
		color: #e09090;
		border-color: rgba(180, 60, 60, 0.35);
	}

	.gh-disconnect-btn:hover:not(:disabled) {
		border-color: rgba(180, 60, 60, 0.7);
		opacity: 1;
	}

	.gh-link {
		color: var(--journal-accent);
		opacity: 0.9;
	}

	.gh-link:hover {
		opacity: 1;
	}
</style>
