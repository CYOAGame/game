<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { githubState, saveGitHubState } from '$lib/stores/github';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { saveWorldState, saveWorldBlocks } from '$lib/engine/world-loader';
	import { decodeInviteCode } from '$lib/invites/invite-code';
	import { validateToken, validateRepo } from '$lib/git/github-client';
	import { fetchRepoFiles, buildWorldBlocksFromFiles, buildWorldStateFromFiles, cacheFiles } from '$lib/git/yaml-loader';
	import { onMount } from 'svelte';

	let status = $state<'input' | 'validating' | 'name-entry' | 'joining' | 'error'>('input');
	let errorMessage = $state('');
	let codeInput = $state('');
	let displayName = $state('');

	let decodedRepo = $state('');
	let decodedToken = $state('');
	let discoveredOwner = $state('');

	onMount(() => {
		const codeParam = page.url.searchParams.get('code');
		if (codeParam) {
			codeInput = codeParam;
			validateCode(codeParam);
		}
	});

	async function validateCode(code: string) {
		status = 'validating';
		errorMessage = '';

		const decoded = decodeInviteCode(code);
		if (!decoded) {
			status = 'error';
			errorMessage = "This invite link doesn't look right. Ask the world owner for a new one.";
			return;
		}

		decodedRepo = decoded.repo;
		decodedToken = decoded.token;

		const tokenResult = await validateToken(decodedToken);
		if (!tokenResult.valid) {
			status = 'error';
			errorMessage = 'This invite has expired or the token was revoked. Ask the world owner for a new link.';
			return;
		}

		const repoResult = await validateRepo(decodedToken, tokenResult.username, decodedRepo);
		if (repoResult.valid) {
			discoveredOwner = tokenResult.username;
		} else {
			status = 'error';
			errorMessage = `Couldn't find the world repo "${decodedRepo}". It may have been renamed or deleted.`;
			return;
		}

		if (!repoResult.canWrite) {
			status = 'error';
			errorMessage = 'This invite token does not have write access to the repo. Ask the world owner to check the token permissions.';
			return;
		}

		status = 'name-entry';
	}

	function handlePasteCode() {
		if (!codeInput.trim()) return;
		validateCode(codeInput.trim());
	}

	async function handleJoin() {
		if (!displayName.trim()) return;
		status = 'joining';

		try {
			const files = await fetchRepoFiles(decodedToken, discoveredOwner, decodedRepo);
			cacheFiles(files);
			const blocks = buildWorldBlocksFromFiles(files);
			const state = buildWorldStateFromFiles(files, blocks.config);

			worldBlocks.set(blocks);
			worldState.set(state);
			saveWorldBlocks(blocks);
			saveWorldState(state);

			const newGhState = {
				isAuthenticated: true,
				username: '',
				displayName: displayName.trim(),
				token: decodedToken,
				authMethod: 'invite-code' as const,
				repoOwner: discoveredOwner,
				repoName: decodedRepo,
				isConnected: true,
				syncStatus: 'idle' as const,
				pendingChanges: []
			};
			githubState.set(newGhState);
			saveGitHubState(newGhState);

			goto(`${base}/journal/setup`);
		} catch (err: any) {
			status = 'error';
			errorMessage = `Couldn't load the world: ${err.message}`;
		}
	}
</script>

<div class="invite-page">
	<div class="invite-inner">
		<h1 class="invite-title">Join a World</h1>

		{#if status === 'input'}
			<p class="invite-desc">Paste your invite code below to join a friend's world.</p>
			<div class="code-input-row">
				<input
					class="field-input"
					type="text"
					placeholder="Paste invite code"
					bind:value={codeInput}
					onkeydown={(e) => { if (e.key === 'Enter') handlePasteCode(); }}
				/>
				<button class="btn btn-primary" onclick={handlePasteCode} disabled={!codeInput.trim()}>
					Join
				</button>
			</div>

		{:else if status === 'validating'}
			<p class="invite-desc">Checking invite...</p>

		{:else if status === 'name-entry'}
			<p class="invite-desc">
				You've been invited to play in <strong>{decodedRepo}</strong>.
			</p>
			<label class="name-label">
				What should we call you?
				<input
					class="field-input name-input"
					type="text"
					placeholder="Your name"
					bind:value={displayName}
					onkeydown={(e) => { if (e.key === 'Enter') handleJoin(); }}
				/>
			</label>
			<button class="btn btn-primary" onclick={handleJoin} disabled={!displayName.trim()}>
				Start Playing
			</button>

		{:else if status === 'joining'}
			<p class="invite-desc">Loading world...</p>

		{:else if status === 'error'}
			<p class="error-msg">{errorMessage}</p>
			<button class="btn btn-secondary" onclick={() => { status = 'input'; errorMessage = ''; }}>
				Try Again
			</button>
		{/if}

		<div class="footer-links">
			<a href="{base}/login" class="footer-link">Login with GitHub instead</a>
		</div>
	</div>
</div>

<style>
	.invite-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--session-end-bg, #1a1a16);
		color: var(--session-end-text, #c8c4b8);
		font-family: var(--journal-font, Georgia, serif);
		padding: 1rem;
	}

	.invite-inner {
		max-width: 440px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.invite-title {
		font-size: 1.6rem;
		font-weight: normal;
		color: var(--journal-accent, #d4b96a);
		text-align: center;
	}

	.invite-desc {
		font-size: 0.95rem;
		line-height: 1.6;
		opacity: 0.8;
		text-align: center;
	}

	.code-input-row {
		display: flex;
		gap: 0.5rem;
	}

	.field-input {
		flex: 1;
		padding: 0.6rem 0.85rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(74, 74, 58, 0.6);
		border-radius: 4px;
		color: var(--session-end-text, #c8c4b8);
		font-family: inherit;
		font-size: 0.9rem;
	}

	.field-input:focus {
		outline: none;
		border-color: var(--journal-accent, #d4b96a);
	}

	.name-label {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.9rem;
		opacity: 0.7;
	}

	.name-input {
		font-size: 1.1rem;
		padding: 0.75rem 1rem;
		text-align: center;
	}

	.btn {
		padding: 0.6rem 1.25rem;
		border-radius: 4px;
		cursor: pointer;
		font-family: inherit;
		font-size: 0.9rem;
		border: 1px solid transparent;
		transition: background 0.15s, border-color 0.15s;
	}

	.btn-primary {
		background: rgba(139, 105, 20, 0.2);
		border-color: rgba(139, 105, 20, 0.5);
		color: var(--journal-accent, #d4b96a);
	}

	.btn-primary:hover:not(:disabled) {
		background: rgba(139, 105, 20, 0.35);
		border-color: var(--journal-accent, #d4b96a);
	}

	.btn-primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-secondary {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(74, 74, 58, 0.6);
		color: var(--session-end-text, #c8c4b8);
	}

	.btn-secondary:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.error-msg {
		color: #e09090;
		font-size: 0.9rem;
		text-align: center;
		padding: 0.75rem;
		border: 1px solid rgba(180, 60, 60, 0.3);
		border-radius: 4px;
		background: rgba(180, 60, 60, 0.08);
	}

	.footer-links {
		text-align: center;
		margin-top: 1rem;
	}

	.footer-link {
		color: var(--session-end-text, #c8c4b8);
		opacity: 0.5;
		font-size: 0.82rem;
		text-decoration: none;
	}

	.footer-link:hover {
		opacity: 1;
	}
</style>
