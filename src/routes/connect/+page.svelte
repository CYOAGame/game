<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { worldState, worldBlocks } from '$lib/stores/world';
	import { githubState, saveGitHubState, clearAuth } from '$lib/stores/github';
	import { playerPrefs, savePlayerPrefs, loadPlayerPrefs } from '$lib/stores/player';
	import { parseRepoUrl, validateRepo, forkRepo, checkForkStatus, syncFork } from '$lib/git/github-client';
	import { fetchRepoFiles, buildWorldBlocksFromFiles, buildWorldStateFromFiles, cacheFiles } from '$lib/git/yaml-loader';
	import { saveWorldState, saveWorldBlocks } from '$lib/engine/world-loader';
	import { AuthExpiredError } from '$lib/git/auth-errors';
	import { encodeInviteCode } from '$lib/invites/invite-code';
	import { onMount } from 'svelte';

	let ghState = $derived($githubState);
	let username = $derived(ghState.username);

	// Create World state
	let forking = $state(false);
	let forkError = $state('');

	// Join World state
	let repoUrl = $state('CYOAGame/Public_Game');
	let joining = $state(false);
	let joinError = $state('');

	// Recent World
	let recentOwner = $state('');
	let recentRepo = $state('');
	let loadingRecent = $state(false);
	let recentError = $state('');

	// Invite link state
	let inviteLink = $state('');
	let inviteLinkCopied = $state(false);

	function generateInviteLink() {
		const ghState = $githubState;
		if (!ghState.token || !ghState.repoName) return;
		const code = encodeInviteCode(ghState.repoOwner, ghState.repoName, ghState.token);
		const origin = typeof window !== 'undefined' ? window.location.origin : '';
		inviteLink = `${origin}${base}/invite?code=${code}`;
		inviteLinkCopied = false;
	}

	async function copyInviteLink() {
		try {
			await navigator.clipboard.writeText(inviteLink);
			inviteLinkCopied = true;
			setTimeout(() => { inviteLinkCopied = false; }, 2000);
		} catch {
			// Fallback: select the text
		}
	}

	// Fork sync state
	let showSyncPrompt = $state(false);
	let syncInfo = $state<{ behindBy: number; parentOwner: string; parentRepo: string } | null>(null);
	let syncingFork = $state(false);
	let syncResult = $state<'idle' | 'success' | 'error'>('idle');

	onMount(() => {
		if (!$githubState.token) {
			goto(`${base}/`);
			return;
		}
		const prefs = loadPlayerPrefs();
		if (prefs.repoOwner && prefs.repoName) {
			recentOwner = prefs.repoOwner;
			recentRepo = prefs.repoName;
		}
	});

	async function connectToRepo(owner: string, repo: string) {
		const tkn = $githubState.token;
		if (!tkn) {
			goto(`${base}/`);
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

		// Check if fork is behind upstream
		const forkStatus = await checkForkStatus(tkn, owner, repo);
		if (forkStatus?.behind) {
			// Don't navigate yet — show sync prompt
			showSyncPrompt = true;
			syncInfo = forkStatus;
			return;
		}

		goto(`${base}/journal/setup`);
	}

	async function handleCreateWorld() {
		forking = true;
		forkError = '';
		try {
			const tkn = $githubState.token;
			if (!tkn) { goto(`${base}/`); return; }
			const result = await forkRepo(tkn, 'CYOAGame', 'ironhaven');
			if (!result) {
				forkError = 'Template repo not found or forbidden. If you authenticated with a fine-grained PAT, use the PAT wizard instead.';
				return;
			}
			await connectToRepo(result.owner, result.repo);
		} catch (err: any) {
			if (err instanceof AuthExpiredError) {
				if ($githubState.authMethod === 'pat') {
					goto(`${base}/setup?error=expired`);
				} else {
					goto(`${base}/?error=invite-expired`);
				}
				return;
			}
			forkError = err?.message ?? 'Fork failed. Please try again.';
		} finally {
			forking = false;
		}
	}

	async function handleJoinPublicWorld() {
		joinError = '';
		joining = true;
		try {
			await connectToRepo('CYOAGame', 'Public_Game');
		} catch (err: any) {
			if (err instanceof AuthExpiredError) {
				if ($githubState.authMethod === 'pat') {
					goto(`${base}/setup?error=expired`);
				} else {
					goto(`${base}/?error=invite-expired`);
				}
				return;
			}
			joinError = err?.message ?? 'Failed to connect to public world.';
		} finally {
			joining = false;
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
			const tkn = $githubState.token;
			if (!tkn) {
				goto(`${base}/`);
				return;
			}
			const validation = await validateRepo(tkn, parsed.owner, parsed.repo);
			if (!validation.valid) {
				joinError = validation.error ?? 'Repository not valid.';
				return;
			}
			await connectToRepo(parsed.owner, parsed.repo);
		} catch (err: any) {
			if (err instanceof AuthExpiredError) {
				if ($githubState.authMethod === 'pat') {
					goto(`${base}/setup?error=expired`);
				} else {
					goto(`${base}/?error=invite-expired`);
				}
				return;
			}
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
			if (err instanceof AuthExpiredError) {
				if ($githubState.authMethod === 'pat') {
					goto(`${base}/setup?error=expired`);
				} else {
					goto(`${base}/?error=invite-expired`);
				}
				return;
			}
			recentError = err?.message ?? 'Failed to load recent world.';
		} finally {
			loadingRecent = false;
		}
	}

	async function handleSync() {
		const tkn = $githubState.token;
		const owner = $githubState.repoOwner;
		const repo = $githubState.repoName;
		if (!tkn || !owner || !repo) return;
		syncingFork = true;
		const result = await syncFork(tkn, owner, repo);
		if (result.success) {
			syncResult = 'success';
			const files = await fetchRepoFiles(tkn, owner, repo);
			const blocks = buildWorldBlocksFromFiles(files);
			const state = buildWorldStateFromFiles(files, blocks.config);
			cacheFiles(files);
			worldBlocks.set(blocks);
			worldState.set(state);
			saveWorldBlocks(blocks);
			saveWorldState(state);
			setTimeout(() => goto(`${base}/journal/setup`), 1500);
		} else {
			syncResult = 'error';
		}
		syncingFork = false;
	}

	function skipSync() {
		showSyncPrompt = false;
		goto(`${base}/journal/setup`);
	}

	function handleLogout() {
		const prefs = loadPlayerPrefs();
		savePlayerPrefs({ ...prefs, repoOwner: undefined, repoName: undefined });
		clearAuth();
		goto(`${base}/`);
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

		<!-- Generate Invite Link -->
		{#if $githubState.repoOwner && $githubState.repoName}
			<section class="section">
				<h2 class="section-title">Invite Link</h2>
				<p class="section-desc">
					Generate a link anyone can use to join your world. No GitHub account needed — they just pick a name and play.
				</p>
				{#if inviteLink}
					<div class="invite-link-display">
						<input
							class="field-input invite-link-field"
							type="text"
							readonly
							value={inviteLink}
							onclick={(e) => (e.target as HTMLInputElement).select()}
						/>
						<button class="btn btn-primary" onclick={copyInviteLink}>
							{inviteLinkCopied ? 'Copied!' : 'Copy'}
						</button>
					</div>
					<p class="section-hint">
						This link contains your repo access token. Share it only with people you trust.
					</p>
				{:else}
					<button class="btn btn-primary" onclick={generateInviteLink}>
						Generate Invite Link
					</button>
				{/if}
			</section>
		{/if}

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

		<!-- Fork Sync Prompt -->
		{#if showSyncPrompt}
			<div class="sync-prompt">
				<h3 class="sync-title">World Update Available</h3>
				<p class="sync-desc">The world template has new content ({syncInfo?.behindBy} updates). Would you like to sync?</p>
				<p class="sync-hint">This brings in new events, archetypes, and other content from the world creator.</p>
				<div class="sync-actions">
					<button class="btn btn-primary" onclick={handleSync} disabled={syncingFork}>
						{syncingFork ? 'Syncing...' : 'Sync Now'}
					</button>
					<button class="btn btn-secondary" onclick={skipSync} disabled={syncingFork}>
						Skip for Now
					</button>
				</div>
				{#if syncResult === 'success'}
					<p class="sync-success">Synced successfully! Loading updated world...</p>
				{:else if syncResult === 'error'}
					<p class="sync-error">Sync failed. You can try again later from Settings.</p>
				{/if}
			</div>
		{/if}

		<!-- Join World -->
		<section class="section">
			<h2 class="section-title">Join World</h2>
			<button
				class="btn btn-primary btn-public"
				onclick={handleJoinPublicWorld}
				disabled={joining}
			>
				{joining ? 'Connecting...' : 'Join Public World'}
			</button>
			<p class="section-desc public-desc">
				Connects to <code>CYOAGame/Public_Game</code> — the shared world for new players.
			</p>
			<div class="section-divider">or enter a repo</div>
			<p class="section-desc">
				Connect to any world repo. Accepts <code>owner/repo</code> or a full GitHub URL.
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

	.btn-public {
		font-size: 1.05rem;
		padding: 0.7rem 1.75rem;
	}

	.public-desc {
		margin-top: -0.25rem;
	}

	.section-divider {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.35;
	}

	.section-divider::before,
	.section-divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--session-end-border);
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

	/* Sync prompt */
	.sync-prompt {
		background: var(--session-end-card-bg);
		border: 1px solid var(--journal-accent);
		border-radius: 6px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.sync-title {
		font-size: 1rem;
		color: var(--journal-accent);
		margin: 0;
		font-weight: normal;
		letter-spacing: 0.04em;
	}

	.sync-desc {
		font-size: 0.9rem;
		margin: 0;
		line-height: 1.5;
	}

	.sync-hint {
		font-size: 0.82rem;
		opacity: 0.6;
		margin: 0;
		line-height: 1.5;
	}

	.sync-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.sync-success {
		font-size: 0.85rem;
		color: #90c890;
		background: rgba(60, 140, 60, 0.15);
		border: 1px solid rgba(60, 140, 60, 0.4);
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		margin: 0;
	}

	.sync-error {
		font-size: 0.85rem;
		color: #e09090;
		background: rgba(180, 60, 60, 0.15);
		border: 1px solid rgba(180, 60, 60, 0.4);
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		margin: 0;
	}

	.invite-link-display {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.invite-link-field {
		flex: 1;
		font-size: 0.8rem;
		font-family: monospace;
		cursor: text;
	}

	.section-hint {
		font-size: 0.78rem;
		opacity: 0.5;
		font-style: italic;
	}
</style>
