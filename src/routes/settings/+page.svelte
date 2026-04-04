<script lang="ts">
	import { onMount } from 'svelte';
	import { playerPrefs, loadPlayerPrefs, savePlayerPrefs } from '$lib/stores/player';
	import { enhanceText, type LLMContext } from '$lib/engine/llm-adapter';
	import type { PlayerPrefs } from '$lib/stores/player';

	let prefs = $state<PlayerPrefs>({
		dayTypePreferences: [],
		llmSetting: 'none',
		llmEndpoint: 'http://localhost:11434/v1',
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
				// enhanceText returned original — means it fell through without calling the API
				// This shouldn't happen if mode isn't 'none', but guard anyway
				testStatus = 'error';
				testMessage = 'No response from LLM. Check your settings and try again.';
			}
		} catch {
			testStatus = 'error';
			testMessage = 'Connection failed. Check the endpoint or API key.';
		}
	}

	function handleSave() {
		savePlayerPrefs(prefs);
		playerPrefs.set(prefs);
		saveStatus = 'saved';
		setTimeout(() => { saveStatus = 'idle'; }, 2000);
	}
</script>

<div class="settings-page">
	<div class="settings-inner">
		<header class="settings-header">
			<a href="/" class="back-link">&larr; Back</a>
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
</style>
