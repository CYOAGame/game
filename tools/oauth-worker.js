// Minimal OAuth token exchange worker for GitHub
// Deploy to Cloudflare Workers
// Set environment secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, APP_URL
//
// Usage:
// 1. Create a GitHub OAuth App at https://github.com/settings/developers
// 2. Set the callback URL to: https://your-worker.workers.dev/callback
// 3. Deploy this worker: wrangler deploy
// 4. Set the worker URL in your game's login page

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname === '/callback') {
			const code = url.searchParams.get('code');
			if (!code) {
				return new Response('Missing code parameter', { status: 400 });
			}
			const response = await fetch('https://github.com/login/oauth/access_token', {
				method: 'POST',
				headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
				body: JSON.stringify({
					client_id: env.GITHUB_CLIENT_ID,
					client_secret: env.GITHUB_CLIENT_SECRET,
					code
				})
			});
			const data = await response.json();
			if (data.access_token) {
				return Response.redirect(`${env.APP_URL}/login?token=${data.access_token}`, 302);
			}
			return Response.redirect(`${env.APP_URL}/login?error=${encodeURIComponent(data.error_description || 'Authentication failed')}`, 302);
		}
		return new Response('Not found', { status: 404 });
	}
};
