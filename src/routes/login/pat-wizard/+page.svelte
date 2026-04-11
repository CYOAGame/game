<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { validateToken, validateRepo } from '$lib/git/github-client';
	import { githubState, saveGitHubState } from '$lib/stores/github';
	import {
		initialWizardState,
		transition,
		saveWizardState,
		loadWizardState,
		clearWizardState,
		type WizardState
	} from './wizard-state';

	let wizState: WizardState = $state(initialWizardState());
	let validating = $state(false);
	let tokenInput = $state('');
	let repoInput = $state('');

	onMount(() => {
		const restored = loadWizardState();
		if (restored) wizState = restored;
	});

	$effect(() => {
		saveWizardState(wizState);
	});

	function act(action: Parameters<typeof transition>[1]) {
		wizState = transition(wizState, action);
	}

	async function submitToken() {
		if (validating) return;
		validating = true;
		try {
			const trimmed = tokenInput.trim();
			if (!trimmed) {
				wizState = { ...wizState, error: 'Please paste a token.' };
				return;
			}
			const tokenCheck = await validateToken(trimmed);
			if (!tokenCheck.valid) {
				wizState = { ...wizState, error: 'GitHub did not accept that token. Double-check it and try again.' };
				return;
			}
			const repoCheck = await validateRepo(trimmed, wizState.repoOwner, wizState.repoName);
			if (!repoCheck.valid) {
				wizState = {
					...wizState,
					error: repoCheck.error ?? 'Token is valid but can\u2019t access that repo. Check permissions and repo scope.'
				};
				return;
			}
			if (!repoCheck.canWrite) {
				wizState = {
					...wizState,
					error: 'Token works but does not have push access to this repo. Re-create it with Contents: Read and write.'
				};
				return;
			}
			// Success — commit to the state machine, then to githubState
			wizState = transition({ ...wizState, token: trimmed }, { type: 'submit-token', value: trimmed });
			const newGhState = {
				isAuthenticated: true,
				username: tokenCheck.username,
				token: trimmed,
				authMethod: 'pat' as const,
				repoOwner: wizState.repoOwner,
				repoName: wizState.repoName,
				isConnected: false,
				syncStatus: 'idle' as const,
				pendingChanges: []
			};
			githubState.set(newGhState);
			saveGitHubState(newGhState);
			clearWizardState();
			goto(`${base}/connect`);
		} finally {
			validating = false;
		}
	}

	function submitRepo() {
		act({ type: 'submit-repo', value: repoInput });
		repoInput = '';
	}

	const IRONHAVEN_URL = 'https://github.com/CYOAGame/ironhaven';
	const NEW_PAT_URL =
		'https://github.com/settings/personal-access-tokens/new?description=Journal+RPG';
</script>

<div class="wizard-page">
	<div class="wizard-inner">
		<header class="wizard-header">
			<h1 class="title">Fine-Grained Access Token</h1>
			<p class="subtitle">Per-repo scope — your token can only touch one world.</p>
		</header>

		{#if wizState.step === 'choose'}
			<section class="section">
				<h2 class="section-title">What do you want to do?</h2>
				<button class="btn btn-primary" onclick={() => act({ type: 'pick-create' })}>
					Create a new world
				</button>
				<p class="section-desc">
					You'll fork the <code>CYOAGame/ironhaven</code> template on GitHub, then
					create a PAT scoped to your fork.
				</p>
				<div class="divider"></div>
				<button class="btn btn-secondary" onclick={() => act({ type: 'pick-join' })}>
					Join a world I'm already a collaborator on
				</button>
				<p class="section-desc">
					You'll create a PAT scoped to that specific world repo.
				</p>
			</section>
		{:else if wizState.step === 'create-step1'}
			<section class="section">
				<h2 class="section-title">Step 1 of 2 — Fork the template</h2>
				<ol class="steps">
					<li>
						<a href={IRONHAVEN_URL} target="_blank" rel="noopener noreferrer">
							Open CYOAGame/ironhaven on GitHub
						</a>
						and click <strong>Fork</strong>.
					</li>
					<li>After the fork completes, come back here and paste the fork URL below.</li>
				</ol>
				<input
					class="field-input"
					type="text"
					placeholder="your-username/ironhaven"
					bind:value={repoInput}
					onkeydown={(e) => { if (e.key === 'Enter') submitRepo(); }}
				/>
				{#if wizState.error}<p class="error-msg">{wizState.error}</p>{/if}
				<div class="actions">
					<button class="btn btn-secondary" onclick={() => act({ type: 'back' })}>Back</button>
					<button class="btn btn-primary" onclick={submitRepo}>Next</button>
				</div>
			</section>
		{:else if wizState.step === 'join-step1'}
			<section class="section">
				<h2 class="section-title">Step 1 of 2 — Confirm your world repo</h2>
				<p class="section-desc">
					You must already be a collaborator on this repo. If you aren't, ask the
					world owner to add you (or use <a href="{base}/login">Login with GitHub</a>).
				</p>
				<input
					class="field-input"
					type="text"
					placeholder="owner/repo"
					bind:value={repoInput}
					onkeydown={(e) => { if (e.key === 'Enter') submitRepo(); }}
				/>
				{#if wizState.error}<p class="error-msg">{wizState.error}</p>{/if}
				<div class="actions">
					<button class="btn btn-secondary" onclick={() => act({ type: 'back' })}>Back</button>
					<button class="btn btn-primary" onclick={submitRepo}>Next</button>
				</div>
			</section>
		{:else if wizState.step === 'create-step2' || wizState.step === 'join-step2'}
			<section class="section">
				<h2 class="section-title">Step 2 of 2 — Create a PAT</h2>
				<p class="section-desc">
					For <code>{wizState.repoOwner}/{wizState.repoName}</code>:
				</p>
				<ol class="steps">
					<li>
						<a href={NEW_PAT_URL} target="_blank" rel="noopener noreferrer">
							Open the GitHub fine-grained PAT page
						</a>
					</li>
					<li>
						Under <strong>Repository access</strong>, choose
						<em>Only select repositories</em> and pick
						<code>{wizState.repoOwner}/{wizState.repoName}</code>.
					</li>
					<li>
						Under <strong>Repository permissions</strong>, grant:
						<ul>
							<li><strong>Contents:</strong> Read and write</li>
							<li><strong>Metadata:</strong> Read (already required)</li>
							<li><strong>Pull requests:</strong> Read and write</li>
						</ul>
					</li>
					<li>Click <strong>Generate token</strong> and paste it below.</li>
				</ol>
				<p class="warning">
					Heads up: if you forget the <strong>Pull requests</strong> permission,
					login will still succeed but your first save will fail. Come back here
					to update the token if that happens.
				</p>
				<input
					class="field-input"
					type="password"
					placeholder="github_pat_..."
					bind:value={tokenInput}
					onkeydown={(e) => { if (e.key === 'Enter') submitToken(); }}
					disabled={validating}
				/>
				{#if wizState.error}<p class="error-msg">{wizState.error}</p>{/if}
				<div class="actions">
					<button class="btn btn-secondary" onclick={() => act({ type: 'back' })} disabled={validating}>Back</button>
					<button class="btn btn-primary" onclick={submitToken} disabled={validating || !tokenInput.trim()}>
						{validating ? 'Validating...' : 'Connect'}
					</button>
				</div>
			</section>
		{/if}

		<div class="footer-links">
			<a href="{base}/login" class="footer-link">Back to login</a>
		</div>
	</div>
</div>

<style>
	.wizard-page {
		min-height: 100vh;
		background-color: var(--session-end-bg);
		color: var(--session-end-text);
		font-family: var(--journal-font);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 1rem;
	}
	.wizard-inner { width: 100%; max-width: 520px; }
	.wizard-header { text-align: center; margin-bottom: 2rem; }
	.title {
		font-size: 2rem;
		color: var(--journal-accent);
		margin: 0 0 0.5rem 0;
		font-weight: normal;
		letter-spacing: 0.04em;
	}
	.subtitle { font-size: 0.9rem; opacity: 0.6; margin: 0; font-style: italic; }
	.section {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.section-title {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.55;
		font-weight: normal;
		margin: 0;
	}
	.section-desc { font-size: 0.85rem; opacity: 0.7; line-height: 1.6; margin: 0; }
	.steps { font-size: 0.88rem; line-height: 1.7; margin: 0; padding-left: 1.2rem; }
	.steps code, .section-desc code {
		font-family: monospace;
		background: rgba(255, 255, 255, 0.07);
		padding: 0.1em 0.3em;
		border-radius: 2px;
	}
	.warning {
		font-size: 0.82rem;
		color: #e0c890;
		background: rgba(180, 150, 60, 0.12);
		border: 1px solid rgba(180, 150, 60, 0.35);
		border-radius: 4px;
		padding: 0.55rem 0.75rem;
		margin: 0;
		line-height: 1.5;
	}
	.field-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.85rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--session-end-border);
		border-radius: 4px;
		color: var(--session-end-text);
		font-family: monospace;
		font-size: 0.9rem;
	}
	.field-input:focus { outline: none; border-color: var(--journal-accent); }
	.field-input:disabled { opacity: 0.5; }
	.error-msg {
		font-size: 0.85rem;
		color: #e09090;
		background: rgba(180, 60, 60, 0.15);
		border: 1px solid rgba(180, 60, 60, 0.4);
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		margin: 0;
	}
	.actions { display: flex; gap: 0.75rem; margin-top: 0.5rem; }
	.btn {
		padding: 0.6rem 1.5rem;
		border-radius: 4px;
		font-family: var(--journal-font);
		font-size: 0.95rem;
		cursor: pointer;
		transition: opacity 0.15s;
		letter-spacing: 0.03em;
		flex: 1;
	}
	.btn:disabled { cursor: not-allowed; opacity: 0.4; }
	.btn-primary { background: var(--journal-accent); border: none; color: #fff8ee; }
	.btn-primary:hover:not(:disabled) { opacity: 0.88; }
	.btn-secondary {
		background: transparent;
		border: 1px solid var(--session-end-border);
		color: var(--session-end-text);
	}
	.btn-secondary:hover:not(:disabled) { border-color: var(--journal-accent); opacity: 0.9; }
	.divider { height: 1px; background: var(--session-end-border); margin: 0.25rem 0; }
	.footer-links { text-align: center; margin-top: 1.5rem; }
	.footer-link {
		font-size: 0.82rem;
		color: var(--session-end-text);
		opacity: 0.35;
		text-decoration: none;
		letter-spacing: 0.06em;
	}
	.footer-link:hover { opacity: 0.7; }
</style>
