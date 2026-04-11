<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { validateToken } from '$lib/git/github-client';
	import { githubState, saveGitHubState, clearAuth } from '$lib/stores/github';
	import { onMount } from 'svelte';
	import { env as publicEnv } from '$env/dynamic/public';

	const CLIENT_ID = publicEnv.PUBLIC_GITHUB_CLIENT_ID ?? '';
	const WORKER_URL = publicEnv.PUBLIC_OAUTH_WORKER_URL ?? '';
	const OAUTH_CONFIGURED = Boolean(CLIENT_ID && WORKER_URL);

	let connecting = $state(false);
	let errorMessage = $state('');

	onMount(async () => {
		const oauthToken = page.url.searchParams.get('token');
		const oauthError = page.url.searchParams.get('error');
		const returnedState = page.url.searchParams.get('state');
		const method = page.url.searchParams.get('method');

		if (oauthError === 'expired') {
			errorMessage = 'Your GitHub session expired. Please reconnect.';
			return;
		}
		if (oauthError) {
			errorMessage = `GitHub login failed: ${decodeURIComponent(oauthError)}`;
			return;
		}
		if (oauthToken && method === 'oauth') {
			const expected = sessionStorage.getItem('oauth-state');
			sessionStorage.removeItem('oauth-state');
			if (!expected || expected !== returnedState) {
				errorMessage = 'Login state did not match — please try again.';
				return;
			}
			await completeLogin(oauthToken, 'oauth');
		}
	});

	function randomState(): string {
		const bytes = new Uint8Array(16);
		crypto.getRandomValues(bytes);
		return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	function startOAuth() {
		if (!OAUTH_CONFIGURED) {
			errorMessage = 'OAuth is not configured for this deployment. See tools/README.md.';
			return;
		}
		const state = randomState();
		sessionStorage.setItem('oauth-state', state);
		const redirectUri = encodeURIComponent(`${WORKER_URL}/callback`);
		const encodedState = encodeURIComponent(state);
		const authorizeUrl =
			`https://github.com/login/oauth/authorize` +
			`?client_id=${encodeURIComponent(CLIENT_ID)}` +
			`&scope=repo` +
			`&redirect_uri=${redirectUri}` +
			`&state=${encodedState}`;
		window.location.href = authorizeUrl;
	}

	async function completeLogin(token: string, authMethod: 'oauth' | 'pat') {
		connecting = true;
		errorMessage = '';
		try {
			const result = await validateToken(token);
			if (!result.valid) {
				clearAuth();
				errorMessage = 'GitHub did not accept that token. Please try again.';
				return;
			}
			const newState = {
				isAuthenticated: true,
				username: result.username,
				token,
				authMethod,
				repoOwner: '',
				repoName: '',
				isConnected: false,
				syncStatus: 'idle' as const,
				pendingChanges: []
			};
			githubState.set(newState);
			saveGitHubState(newState);
			goto(`${base}/connect`);
		} catch {
			errorMessage = 'Connection failed. Check your network and try again.';
		} finally {
			connecting = false;
		}
	}

	function goToPatWizard() {
		goto(`${base}/login/pat-wizard`);
	}
</script>

<div class="login-page">
	<div class="login-inner">
		<header class="login-header">
			<h1 class="title">Journal RPG</h1>
			<p class="subtitle">Connect to GitHub to save your world</p>
		</header>

		{#if errorMessage}
			<p class="error-msg">{errorMessage}</p>
		{/if}

		<section class="section section-oauth">
			<button class="btn btn-primary" onclick={startOAuth} disabled={connecting || !OAUTH_CONFIGURED}>
				{connecting ? 'Connecting...' : 'Login with GitHub'}
			</button>
			<p class="section-desc">
				Fastest path. Grants read/write access to your GitHub repositories — scope is the
				same as any other GitHub-integrated dev tool.
			</p>
			{#if !OAUTH_CONFIGURED}
				<p class="oauth-note">
					OAuth is not configured. See <code>tools/README.md</code> to register an OAuth App
					and deploy the token exchange worker.
				</p>
			{/if}
		</section>

		<div class="divider">
			<span class="divider-text">or</span>
		</div>

		<section class="section">
			<h2 class="section-title">Fine-Grained Access Token</h2>
			<p class="section-desc">
				Skeptic path. Create a GitHub token scoped to <em>exactly one</em> repo. The game
				cannot touch any of your other repositories.
			</p>
			<button class="btn btn-secondary" onclick={goToPatWizard} disabled={connecting}>
				Use a Personal Access Token
			</button>
		</section>

		<div class="footer-links">
			<a href="{base}/?offline=true" class="footer-link">Play Offline</a>
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
	.login-inner { width: 100%; max-width: 440px; }
	.login-header { text-align: center; margin-bottom: 2rem; }
	.title {
		font-size: 2.5rem;
		color: var(--journal-accent);
		margin: 0 0 0.5rem 0;
		letter-spacing: 0.04em;
		font-weight: normal;
	}
	.subtitle { font-size: 0.95rem; opacity: 0.6; margin: 0; font-style: italic; }
	.section {
		background: var(--session-end-card-bg);
		border: 1px solid var(--session-end-border);
		border-radius: 6px;
		padding: 1.5rem;
		margin-bottom: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.section-oauth { text-align: center; }
	.section-title {
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.5;
		font-weight: normal;
		margin: 0;
	}
	.section-desc { font-size: 0.85rem; opacity: 0.65; line-height: 1.6; margin: 0; }
	.oauth-note code {
		font-family: monospace;
		background: rgba(255, 255, 255, 0.07);
		padding: 0.1em 0.3em;
		border-radius: 2px;
	}
	.oauth-note {
		font-size: 0.78rem;
		opacity: 0.5;
		margin: 0;
		line-height: 1.5;
	}
	.btn {
		padding: 0.6rem 1.5rem;
		border-radius: 4px;
		font-family: var(--journal-font);
		font-size: 0.95rem;
		cursor: pointer;
		transition: opacity 0.15s;
		letter-spacing: 0.03em;
		width: 100%;
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
	.divider {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 1rem 0;
	}
	.divider::before, .divider::after {
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
	.error-msg {
		font-size: 0.85rem;
		color: #e09090;
		background: rgba(180, 60, 60, 0.15);
		border: 1px solid rgba(180, 60, 60, 0.4);
		border-radius: 4px;
		padding: 0.5rem 0.75rem;
		margin: 0 0 1rem 0;
	}
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
