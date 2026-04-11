// Minimal OAuth token exchange worker for GitHub
// Deploy to Cloudflare Workers.
// Set environment secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, APP_URL
// See tools/README.md for deployment instructions.

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.pathname === '/callback') {
			const code = url.searchParams.get('code');
			const state = url.searchParams.get('state') ?? '';
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
			const encodedState = encodeURIComponent(state);
			if (data.access_token) {
				const redirectUrl =
					`${env.APP_URL}/login?token=${data.access_token}` +
					`&method=oauth&state=${encodedState}`;
				return Response.redirect(redirectUrl, 302);
			}
			const errMsg = encodeURIComponent(data.error_description || 'Authentication failed');
			return Response.redirect(
				`${env.APP_URL}/login?error=${errMsg}&state=${encodedState}`,
				302
			);
		}
		return new Response('Not found', { status: 404 });
	}
};
