<script lang="ts">
	import { goto } from '$app/navigation';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { githubState, saveGitHubState } from '$lib/stores/github';
	import { playerPrefs, savePlayerPrefs, loadPlayerPrefs } from '$lib/stores/player';
	import { parseRepoUrl, validateRepo, forkRepo } from '$lib/git/github-client';
	import { fetchRepoFiles, buildWorldBlocksFromFiles, buildWorldStateFromFiles, cacheFiles } from '$lib/git/yaml-loader';
	import { saveWorldState, saveWorldBlocks } from '$lib/engine/world-loader';
	import { onMount } from 'svelte';

	let ghState = $derived($githubState);
	let username = $derived(ghState.username);
	let token = $derived(ghState.token);

	// Create World state
	let forking = $state(false);
	let forkError = $state('');

	// Join World state
	let repoUrl = $state('');
	let joining = $state(false);
	let joinError = $state('');

	// Recent World
	let recentOwner = $state('');
	let recentRepo = $state('');
	let loadingRecent = $state(false);
	let recentError = $state('');

	onMount(() => {
		const prefs = loadPlayerPrefs();
		if (!prefs.githubToken) {
			goto('/login');
			return;
		}
		if (prefs.repoOwner && prefs.repoName) {
			recentOwner = prefs.repoOwner;
			recentRepo = prefs.repoName;
		}
	});

	async function connectToRepo(owner: string, repo: string) {
		const prefs = loadPlayerPrefs();
		const tkn = prefs.githubToken ?? token;
		if (!tkn) {
			goto('/login');
			return;
		}
		const files = await fetchRepoFiles(tkn, owner, repo);
		const blocks = buildWorldBlocksFromFiles(files);
		const state = buildWorldStateFromFiles(files, blocks.config);
		cacheFiles(files);
		worldBlocks.set(blocks);
		worldState.set(state);
		saveWorldBlocks(blocks);
		saveWorldState(state);
		githubState.update(s => ({
			...s,
			repoOwner: owner,
			repoName: repo,
			isConnected: true,
			syncStatus: 'synced'
		}));
		const updatedPrefs = loadPlayerPrefs();
		savePlayerPrefs({ ...updatedPrefs, repoOwner: owner, repoName: repo });
		saveGitHubState($githubState);
		goto('/journal/setup');
	}

	async function handleCreateWorld() {
		forking = true;
		forkError = '';
		try {
			const prefs = loadPlayerPrefs();
			const tkn = prefs.githubToken ?? token;
			if (!tkn) {
				goto('/login');
				return;
			}
			const result = await forkRepo(tkn, 'CYOAGame', 'ironhaven');
			if (!result) {
				forkError = 'Template repo not found. Ask the admin to set up CYOAGame/ironhaven.';
				return;
			}
			await connectToRepo(result.owner, result.repo);
		} catch (err: any) {
			forkError = err?.message ?? 'Fork failed. Please try again.';
		} finally {
			forking = false;
		}
	}

	async function handleJoinWorld() {
		joinError = '';
		const parsed = parseRepoUrl(repoUrl);
		if (!parsed) {
			joinError = 'Could not parse repository URL. Try owner/repo or a full GitHub URL.';
			return;
		}
		joining = true;
		try {
			const prefs = loadPlayerPrefs();
			const tkn = prefs.githubToken ?? token;
			if (!tkn) {
				goto('/login');
				return;
			}
			const validation = await validateRepo(tkn, parsed.owner, parsed.repo);
			if (!validation.valid) {
				joinError = validation.error ?? 'Repository not valid.';
				return;
			}
			await connectToRepo(parsed.owner, parsed.repo);
		} catch (err: any) {
			joinError = err?.message ?? 'Failed to connect to repository.';
		} finally {
			joining = false;
		}
	}

	async function handleRecentWorld() {
		loadingRecent = true;
		recentError = '';
		try {
			await connectToRepo(recentOwner, recentRepo);
		} catch (err: any) {
			recentError = err?.message ?? 'Failed to load recent world.';
		} finally {
			loadingRecent = false;
		}
	}

	function handleLogout() {
		const prefs = loadPlayerPrefs();
		savePlayerPrefs({ ...prefs, githubToken: undefined, githubUsername: undefined, repoOwner: undefined, repoName: undefined });
		githubState.set({
			isAuthenticated: false,
			username: '',
			token: '',
			repoOwner: '',
			repoName: '',
			isConnected: false,
			syncStatus: 'idle',
			pendingChanges: []
		});
		goto('/login');
	}
</script>

<div class="connect-page">
	<div class="connect-inner">
		<!-- Header -->
		<header class="connect-header">
			<h1 class="title">Choose Your World</h1>
			{#if username}
				<div class="user-row">
					<span class="username">Welcome, {username}</span>
					<button class="logout-btn" onclick={handleLogout}>Logout</button>
				</div>
			{/if}
		</header>

		<!-- Recent World -->
		{#if recentOwner && recentRepo}
			<section class="section">
				<h2 class="section-title">Recent World</h2>
				<button
					class="recent-card"
					onclick={handleRecentWorld}
					disabled={loadingRecent}
				>
					<span class="recent-repo">{recentOwner}/{recentRepo}</span>
					<span class="recent-sub">{loadingRecent ? 'Loading...' : 'Click to continue'}</span>
				</button>
				{#if recentError}
					<p class="error-msg">{recentError}</p>
				{/if}
			</section>
		{/if}

		<!-- Create World -->
		<section class="section">
			<h2 class="section-title">Create World</h2>
			<p class="section-desc">
				Fork the <code>CYOAGame/ironhaven</code> template to your GitHub account and start fresh.
			</p>
			{#if forkError}
				<p class="error-msg">{forkError}</p>
			{/if}
			<button
				class="btn btn-primary"
				onclick={handleCreateWorld}
				disabled={forking}
			>
				{forking ? 'Creating World...' : 'Create New World'}
			</button>
		</section>

		<!-- Join World -->
		<section class="section">
			<h2 class="section-title">Join World</h2>
			<p class="section-desc">
				Connect to an existing world repo. Accepts <code>owner/repo</code> or a full GitHub URL.
			</p>
			<div class="field-group">
				<input
					class="field-input"
					type="text"
					placeholder="owner/repo or https://github.com/owner/repo"
					bind:value={repoUrl}
					disabled={joining}
					onkeydown={(e) => { if (e.key === 'Enter') handleJoinWorld(); }}
				/>
			</div>
			{#if joinError}
				<p class="error-msg">{joinError}</p>
			{/if}
			<button
				class="btn btn-secondary"
				onclick={handleJoinWorld}
				disabled={joining || !repoUrl.trim()}
			>
				{joining ? 'Connecting...' : 'Connect'}
			</button>
		</section>
	</div>
</div>

<style>
	.connect-page {
		min-height: 100vh;
		background-color: var(--session-end-bg);
		color: var(--session-end-text);
		font-family: var(--journal-font);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 2.5rem 1rem;
	}

	.connect-inner {
		width: 100%;
		max-width: 520px;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.connect-header {
		margin-bottom: 0.5rem;
	}

	.title {
		font-size: 2rem;
		color: var(--journal-accent);
		margin: 0 0 0.5rem 0;
		font-weight: normal;
		letter-spacing: 0.04em;
	}

	.user-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.username {
		font-size: 0.9rem;
		opacity: 0.7;
	}

	.logout-btn {
		background: none;
		border: none;
		color: var(--session-end-text);
		font-family: var(--journal-font);
		font-size: 0.82rem;
		opacity: 0.4;
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
		transition: opacity 0.15s;
	}

	.logout-btn:hover {
		opacity: 0.75;
	}

	.section {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.section-title {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		opacity: 0.45;
		font-weight: normal;
		margin: 0;
	}

	.section-desc {
		font-size: 0.85rem;
		opacity: 0.65;
		line-height: 1.6;
		margin: 0;
	}

	.section-desc code {
		font-family: monospace;
		background: rgba(255, 255, 255, 0.07);
		padding: 0.1em 0.3em;
		border-radius: 2px;
	}

	/* Recent card */
	.recent-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
		padding: 0.85rem 1rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--session-end-border);
		border-radius: 4px;
		cursor: pointer;
		font-family: var(--journal-font);
		color: var(--session-end-text);
		text-align: left;
		transition: background 0.15s, border-color 0.15s;
		width: 100%;
	}

	.recent-card:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.08);
		border-color: var(--journal-accent);
	}

	.recent-card:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.recent-repo {
		font-family: monospace;
		font-size: 0.95rem;
		color: var(--journal-accent);
	}

	.recent-sub {
		font-size: 0.78rem;
		opacity: 0.45;
	}

	/* Fields */
	.field-group {
		margin: 0;
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
		font-size: 0.88rem;
	}

	.field-input:focus {
		outline: none;
		border-color: var(--journal-accent);
	}

	.field-input:disabled {
		opacity: 0.5;
	}

	/* Buttons */
	.btn {
		padding: 0.6rem 1.5rem;
		border-radius: 4px;
		font-family: var(--journal-font);
		font-size: 0.95rem;
		cursor: pointer;
		transition: opacity 0.15s;
		letter-spacing: 0.03em;
	}

	.btn:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.btn-primary {
		background: var(--journal-accent);
		border: none;
		color: #fff8ee;
	}

	.btn-primary:hover:not(:disabled) {
		opacity: 0.88;
	}

	.btn-secondary {
		background: transparent;
		border: 1px solid var(--session-end-border);
		color: var(--session-end-text);
	}

	.btn-secondary:hover:not(:disabled) {
		border-color: var(--journal-accent);
		opacity: 0.9;
	}

	/* Error */
	.error-msg {
		font-size: 0.85rem;
		color: #e09090;
		background: rgba(180, 60, 60, 0.15);
		border: 1px solid rgba(180, 60, 60, 0.4);
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		margin: 0;
	}
</style>
