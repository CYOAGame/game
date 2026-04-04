<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { validateToken } from '$lib/git/github-client';
	import { playerPrefs, savePlayerPrefs, loadPlayerPrefs } from '$lib/stores/player';
	import { githubState, saveGitHubState } from '$lib/stores/github';
	import { onMount } from 'svelte';

	let token = $state('');
	let connecting = $state(false);
	let errorMessage = $state('');

	onMount(async () => {
		// Check for OAuth callback token in URL
		const oauthToken = page.url.searchParams.get('token');
		const oauthError = page.url.searchParams.get('error');
		if (oauthError) {
			errorMessage = `GitHub login failed: ${oauthError}`;
			return;
		}
		if (oauthToken) {
			token = oauthToken;
			await handleConnect(oauthToken);
		}
	});

	async function handleConnect(tokenValue?: string) {
		const useToken = tokenValue ?? token;
		if (!useToken.trim()) {
			errorMessage = 'Please enter a token.';
			return;
		}
		connecting = true;
		errorMessage = '';
		try {
			const result = await validateToken(useToken);
			if (result.valid) {
				const prefs = loadPlayerPrefs();
				savePlayerPrefs({ ...prefs, githubToken: useToken, githubUsername: result.username });
				playerPrefs.update(p => ({ ...p, githubToken: useToken, githubUsername: result.username }));
				githubState.update(s => ({
					...s,
					isAuthenticated: true,
					username: result.username,
					token: useToken
				}));
				saveGitHubState({
					isAuthenticated: true,
					username: result.username,
					token: useToken,
					repoOwner: '',
					repoName: '',
					isConnected: false,
					syncStatus: 'idle',
					pendingChanges: []
				});
				goto('/connect');
			} else {
				errorMessage = 'Invalid token. Check your GitHub PAT and try again.';
			}
		} catch {
			errorMessage = 'Connection failed. Check your network and try again.';
		} finally {
			connecting = false;
		}
	}
</script>

<div class="login-page">
	<div class="login-inner">
		<header class="login-header">
			<h1 class="title">Journal RPG</h1>
			<p class="subtitle">Connect to GitHub to save your world</p>
		</header>

		<!-- PAT Login Section -->
		<section class="section">
			<h2 class="section-title">Personal Access Token</h2>
			<p class="section-desc">
				Create a PAT at
				<a
					href="https://github.com/settings/tokens/new?scopes=repo&description=Journal+RPG"
					target="_blank"
					rel="noopener noreferrer"
					class="link"
				>
					github.com/settings/tokens
				</a>
				with <code>repo</code> scope.
			</p>
			<div class="field-group">
				<input
					class="field-input"
					type="password"
					placeholder="ghp_..."
					bind:value={token}
					disabled={connecting}
					onkeydown={(e) => { if (e.key === 'Enter') handleConnect(); }}
				/>
			</div>
			{#if errorMessage}
				<p class="error-msg">{errorMessage}</p>
			{/if}
			<button
				class="btn btn-primary"
				onclick={() => handleConnect()}
				disabled={connecting || !token.trim()}
			>
				{connecting ? 'Connecting...' : 'Connect'}
			</button>
		</section>

		<div class="divider">
			<span class="divider-text">or</span>
		</div>

		<!-- OAuth Placeholder Section -->
		<section class="section section-oauth">
			<button class="btn btn-oauth" disabled>
				Login with GitHub
			</button>
			<p class="oauth-note">
				Requires OAuth worker setup — see <code>tools/oauth-worker.js</code>
			</p>
		</section>

		<div class="footer-links">
			<a href="/?offline=true" class="footer-link">Play Offline</a>
		</div>
	</div>
</div>

<style>
	.login-page {
		min-height: 100vh;
		background-color: var(--session-end-bg);
		color: var(--session-end-text);
		font-family: var(--journal-font);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 1rem;
	}

	.login-inner {
		width: 100%;
		max-width: 440px;
	}

	.login-header {
		text-align: center;
		margin-bottom: 2.5rem;
	}

	.title {
		font-size: 2.5rem;
		color: var(--journal-accent);
		margin: 0 0 0.5rem 0;
		letter-spacing: 0.04em;
		font-weight: normal;
	}

	.subtitle {
		font-size: 0.95rem;
		opacity: 0.6;
		margin: 0;
		font-style: italic;
	}

	.section {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 1.5rem;
		margin-bottom: 0;
	}

	.section-title {
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.5;
		font-weight: normal;
		margin: 0 0 0.75rem 0;
	}

	.section-desc {
		font-size: 0.85rem;
		opacity: 0.65;
		line-height: 1.6;
		margin: 0 0 1rem 0;
	}

	.link {
		color: var(--journal-accent);
		opacity: 0.9;
	}

	.link:hover {
		opacity: 1;
	}

	.field-group {
		margin-bottom: 0.75rem;
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

	.field-input:focus {
		outline: none;
		border-color: var(--journal-accent);
	}

	.field-input:disabled {
		opacity: 0.5;
	}

	.error-msg {
		font-size: 0.85rem;
		color: #e09090;
		background: rgba(180, 60, 60, 0.15);
		border: 1px solid rgba(180, 60, 60, 0.4);
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		margin: 0 0 0.75rem 0;
	}

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
		width: 100%;
	}

	.btn-primary:hover:not(:disabled) {
		opacity: 0.88;
	}

	.divider {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 1rem 0;
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--session-end-border);
	}

	.divider-text {
		font-size: 0.8rem;
		opacity: 0.4;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.section-oauth {
		text-align: center;
	}

	.btn-oauth {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--session-end-border);
		color: var(--session-end-text);
		width: 100%;
		margin-bottom: 0.75rem;
	}

	.oauth-note {
		font-size: 0.78rem;
		opacity: 0.45;
		margin: 0;
		line-height: 1.5;
	}

	.oauth-note code {
		font-family: monospace;
		background: rgba(255, 255, 255, 0.07);
		padding: 0.1em 0.3em;
		border-radius: 2px;
	}

	.footer-links {
		text-align: center;
		margin-top: 1.5rem;
	}

	.footer-link {
		font-size: 0.82rem;
		color: var(--session-end-text);
		opacity: 0.35;
		text-decoration: none;
		letter-spacing: 0.06em;
		transition: opacity 0.15s;
	}

	.footer-link:hover {
		opacity: 0.7;
	}
</style>
