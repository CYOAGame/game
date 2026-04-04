import { Octokit } from 'octokit';

let octokitInstance: Octokit | null = null;

export function getOctokit(token: string): Octokit {
	if (!octokitInstance || (octokitInstance as any).__token !== token) {
		octokitInstance = new Octokit({ auth: token });
		(octokitInstance as any).__token = token;
	}
	return octokitInstance;
}

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
	if (!url || !url.trim()) return null;
	let cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
	const urlMatch = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/);
	if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
	const shortMatch = cleaned.match(/^([^/]+)\/([^/]+)$/);
	if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };
	return null;
}

export async function validateToken(token: string): Promise<{ valid: boolean; username: string }> {
	try {
		const octokit = getOctokit(token);
		const { data } = await octokit.rest.users.getAuthenticated();
		return { valid: true, username: data.login };
	} catch {
		return { valid: false, username: '' };
	}
}

export async function validateRepo(token: string, owner: string, repo: string): Promise<{ valid: boolean; canWrite: boolean; error?: string }> {
	try {
		const octokit = getOctokit(token);
		const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
		try {
			await octokit.rest.repos.getContent({ owner, repo, path: 'world.yaml' });
		} catch {
			return { valid: false, canWrite: false, error: "No world.yaml found — this doesn't look like a Journal RPG world repo" };
		}
		const canWrite = repoData.permissions?.push ?? false;
		return { valid: true, canWrite };
	} catch {
		return { valid: false, canWrite: false, error: 'Repository not found or not accessible' };
	}
}

export async function forkRepo(token: string, templateOwner: string, templateRepo: string): Promise<{ owner: string; repo: string } | null> {
	try {
		const octokit = getOctokit(token);
		const { data } = await octokit.rest.repos.createFork({ owner: templateOwner, repo: templateRepo });
		return { owner: data.owner.login, repo: data.name };
	} catch {
		return null;
	}
}

export async function listUserRepos(token: string): Promise<Array<{ owner: string; repo: string; description: string }>> {
	try {
		const octokit = getOctokit(token);
		const { data } = await octokit.rest.repos.listForAuthenticatedUser({ sort: 'updated', per_page: 20 });
		return data.map(r => ({ owner: r.owner.login, repo: r.name, description: r.description ?? '' }));
	} catch {
		return [];
	}
}
