import { Octokit } from 'octokit';
import { AuthExpiredError } from './auth-errors';
import { clearAuth } from '../stores/github';

/**
 * Wrap a runtime Octokit call so that 401s are promoted to AuthExpiredError
 * and the in-memory + persisted session is cleared. Non-401 errors pass
 * through unchanged. Use this for calls made AFTER a valid session exists,
 * NOT for login-time validators like validateToken / validateRepo.
 */
export async function handleRequest<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		const status =
			(err as { status?: number })?.status ??
			(err as { response?: { status?: number } })?.response?.status;
		if (status === 401) {
			clearAuth();
			throw new AuthExpiredError();
		}
		throw err;
	}
}

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
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const { data } = await octokit.rest.repos.createFork({ owner: templateOwner, repo: templateRepo });
			return { owner: data.owner.login, repo: data.name };
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return null;
	}
}

export async function listUserRepos(token: string): Promise<Array<{ owner: string; repo: string; description: string }>> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const { data } = await octokit.rest.repos.listForAuthenticatedUser({ sort: 'updated', per_page: 20 });
			return data.map(r => ({ owner: r.owner.login, repo: r.name, description: r.description ?? '' }));
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return [];
	}
}

/**
 * Check if a repo is a fork and if it's behind its parent.
 * Returns null if not a fork, or { behind: true/false, behindBy: number, parentOwner, parentRepo }
 */
export async function checkForkStatus(
	token: string,
	owner: string,
	repo: string
): Promise<{ isFork: boolean; behind: boolean; behindBy: number; parentOwner: string; parentRepo: string } | null> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
			if (!repoData.parent) return null;
			const parentOwner = repoData.parent.owner.login;
			const parentRepo = repoData.parent.name;
			try {
				const { data: comparison } = await octokit.rest.repos.compareCommits({
					owner: parentOwner,
					repo: parentRepo,
					base: `${owner}:main`,
					head: `${parentOwner}:main`
				});
				return {
					isFork: true,
					behind: comparison.ahead_by > 0,
					behindBy: comparison.ahead_by,
					parentOwner,
					parentRepo
				};
			} catch {
				return { isFork: true, behind: true, behindBy: 0, parentOwner, parentRepo };
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return null;
	}
}

/**
 * Sync a fork with its upstream parent (merge upstream changes).
 */
export async function syncFork(
	token: string,
	owner: string,
	repo: string
): Promise<{ success: boolean; error?: string }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			try {
				await octokit.rest.repos.mergeUpstream({ owner, repo, branch: 'main' });
				return { success: true };
			} catch (err: any) {
				try {
					await octokit.rest.repos.mergeUpstream({ owner, repo, branch: 'master' });
					return { success: true };
				} catch (err2: any) {
					return { success: false, error: err2.message ?? err.message ?? 'Sync failed' };
				}
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Sync failed' };
	}
}

/**
 * Add a user as a collaborator on a repo with push permission.
 * Requires the authenticated user to have admin or maintain permission.
 *
 * Returns:
 * - { success: true } on successful add
 * - { success: true, alreadyCollaborator: true } if the user is already a
 *   collaborator (GitHub returns 422 in this case — treated as success so
 *   orchestration code doesn't have to special-case it)
 * - { success: false, error } on permission denied (403), user not found
 *   (404), or any other non-401 failure
 *
 * Note: 401 errors are re-thrown as AuthExpiredError, consistent with other
 * wrappers in this file, so callers can redirect to the login page.
 */
export async function addCollaborator(
	token: string,
	owner: string,
	repo: string,
	username: string
): Promise<{ success: boolean; error?: string; alreadyCollaborator?: boolean }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			try {
				await octokit.rest.repos.addCollaborator({
					owner,
					repo,
					username,
					permission: 'push'
				});
				return { success: true };
			} catch (err: any) {
				// 422 = user is already a collaborator (or invitation pending)
				if (err.status === 422) {
					return { success: true, alreadyCollaborator: true };
				}
				// 403 = forbidden (caller lacks admin)
				// 404 = user not found
				// 401 = auth token expired (will be caught by outer catch)
				// Anything else: surface to caller
				return {
					success: false,
					error: err.message ?? `GitHub returned ${err.status ?? 'unknown'}`
				};
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Add collaborator failed' };
	}
}
