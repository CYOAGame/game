<script lang="ts">
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { githubState } from '$lib/stores/github';
	import { listJoinRequests } from '$lib/invites/invite-client';
	import { AuthExpiredError } from '$lib/git/auth-errors';

	let count = $state(0);

	onMount(async () => {
		const gh = $githubState;
		if (!gh.token || !gh.repoOwner || !gh.repoName) return;
		try {
			const reqs = await listJoinRequests(gh.token, gh.repoOwner, gh.repoName);
			count = reqs.length;
		} catch (err) {
			if (err instanceof AuthExpiredError) {
				// Let the existing expiry flow handle the redirect — just don't render a badge
				return;
			}
			// Any other error → render nothing. Missing permissions, 404, etc.
			// fall through silently.
		}
	});

	function openConnect() {
		goto(`${base}/connect`);
	}
</script>

{#if count > 0}
	<button class="invites-badge" onclick={openConnect} title="View pending invites">
		{count} pending invite{count === 1 ? '' : 's'}
	</button>
{/if}

<style>
	.invites-badge {
		display: inline-block;
		background: var(--journal-accent);
		color: #fff8ee;
		border: none;
		border-radius: 4px;
		padding: 0.3rem 0.65rem;
		font-family: var(--journal-font);
		font-size: 0.78rem;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.invites-badge:hover {
		opacity: 0.85;
	}
</style>
