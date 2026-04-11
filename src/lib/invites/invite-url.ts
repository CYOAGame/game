/**
 * Builds the pre-filled GitHub issue URL for a join request.
 * Opening this URL in a new tab lands the user on github.com's issue
 * creation page with all fields pre-populated. GitHub's own session
 * authenticates the issue submission — no game-side token is used.
 */
export function buildJoinRequestUrl(owner: string, repo: string, appUrl: string): string {
	const base = `https://github.com/${owner}/${repo}/issues/new`;
	const body =
		`I'd like to join this world in the Journal RPG game.\n\n` +
		`Game: ${appUrl}\n\n` +
		`(This issue was pre-filled by the game. The world owner will approve or deny your request. ` +
		`If approved, GitHub will email you a collaborator invite link — accept it to start playing.)`;
	const params = new URLSearchParams({
		labels: 'journal-rpg/join-request',
		title: 'Join request',
		body
	});
	return `${base}?${params.toString()}`;
}
