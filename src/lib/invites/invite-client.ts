import { getOctokit, handleRequest } from '$lib/git/github-client';
import { AuthExpiredError } from '$lib/git/auth-errors';

export const JOIN_REQUEST_LABEL = 'journal-rpg/join-request';

export interface JoinRequest {
	issueNumber: number;
	username: string;
	avatarUrl: string;
	submittedAt: string;
	repoOwner: string;
	repoName: string;
}

/**
 * Minimal Octokit-shaped interface used by invite-client. Defining our own
 * lets tests inject fake Octokits without dragging in Octokit's full type.
 */
export interface InviteOctokit {
	rest: {
		issues: {
			listForRepo(params: {
				owner: string;
				repo: string;
				labels: string;
				state: string;
			}): Promise<{ data: any[] }>;
			createComment(params: {
				owner: string;
				repo: string;
				issue_number: number;
				body: string;
			}): Promise<any>;
			update(params: {
				owner: string;
				repo: string;
				issue_number: number;
				state: 'open' | 'closed';
			}): Promise<any>;
		};
		repos: {
			addCollaborator(params: {
				owner: string;
				repo: string;
				username: string;
				permission: string;
			}): Promise<any>;
		};
	};
}

// ---------- Testable Impl functions ----------

/**
 * Fetches open join-request issues and maps them to JoinRequest records.
 * Filters out pull requests (the issues API returns both).
 */
export async function listJoinRequestsImpl(
	octokit: InviteOctokit,
	owner: string,
	repo: string
): Promise<JoinRequest[]> {
	const { data } = await octokit.rest.issues.listForRepo({
		owner,
		repo,
		labels: JOIN_REQUEST_LABEL,
		state: 'open'
	});
	return data
		.filter((issue: any) => !issue.pull_request)
		.map((issue: any) => ({
			issueNumber: issue.number,
			username: issue.user?.login ?? '',
			avatarUrl: issue.user?.avatar_url ?? '',
			submittedAt: issue.created_at ?? '',
			repoOwner: owner,
			repoName: repo
		}));
}

/**
 * Orchestrates approval: addCollaborator → createComment → update(closed).
 * Stops early on addCollaborator failure. Swallows post-add failures
 * (comment/close) so the user-visible outcome (the collaborator add)
 * reflects the return value.
 */
export async function approveJoinRequestImpl(
	octokit: InviteOctokit,
	req: JoinRequest
): Promise<{ success: boolean; error?: string }> {
	try {
		await octokit.rest.repos.addCollaborator({
			owner: req.repoOwner,
			repo: req.repoName,
			username: req.username,
			permission: 'push'
		});
	} catch (err: any) {
		if (err.status === 422) {
			// Already a collaborator — proceed to comment + close
		} else {
			if (err.status === 401) throw err;
			const explain =
				err.status === 403
					? 'lacks admin permission on this repo'
					: err.message ?? 'unknown error';
			return {
				success: false,
				error: `Can't add collaborator — your token ${explain}. Log in via OAuth to approve, or re-create your PAT with Administration: Read and write.`
			};
		}
	}

	// Post-add bookkeeping: best-effort only
	try {
		await octokit.rest.issues.createComment({
			owner: req.repoOwner,
			repo: req.repoName,
			issue_number: req.issueNumber,
			body: "Welcome! You've been added as a collaborator. Check your GitHub notifications / email for an invite link — accept it to start playing."
		});
	} catch {
		// best-effort: the collaborator was still added
	}

	try {
		await octokit.rest.issues.update({
			owner: req.repoOwner,
			repo: req.repoName,
			issue_number: req.issueNumber,
			state: 'closed'
		});
	} catch {
		// best-effort
	}

	return { success: true };
}

/**
 * Denies a request by posting a comment and closing the issue. No
 * collaborator is touched.
 */
export async function denyJoinRequestImpl(
	octokit: InviteOctokit,
	req: JoinRequest,
	reason?: string
): Promise<{ success: boolean; error?: string }> {
	const body = reason ?? 'Your request was not approved at this time.';
	try {
		await octokit.rest.issues.createComment({
			owner: req.repoOwner,
			repo: req.repoName,
			issue_number: req.issueNumber,
			body
		});
		await octokit.rest.issues.update({
			owner: req.repoOwner,
			repo: req.repoName,
			issue_number: req.issueNumber,
			state: 'closed'
		});
		return { success: true };
	} catch (err: any) {
		if (err.status === 401) throw err;
		return {
			success: false,
			error: err.message ?? 'Failed to deny request'
		};
	}
}

// ---------- Public token-accepting API ----------

export async function listJoinRequests(
	token: string,
	owner: string,
	repo: string
): Promise<JoinRequest[]> {
	try {
		return await handleRequest(() =>
			listJoinRequestsImpl(getOctokit(token) as unknown as InviteOctokit, owner, repo)
		);
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		// 403/404 etc: return empty list so the UI gracefully shows nothing
		return [];
	}
}

export async function approveJoinRequest(
	token: string,
	req: JoinRequest
): Promise<{ success: boolean; error?: string }> {
	try {
		return await handleRequest(() =>
			approveJoinRequestImpl(getOctokit(token) as unknown as InviteOctokit, req)
		);
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Approve failed' };
	}
}

export async function denyJoinRequest(
	token: string,
	req: JoinRequest,
	reason?: string
): Promise<{ success: boolean; error?: string }> {
	try {
		return await handleRequest(() =>
			denyJoinRequestImpl(getOctokit(token) as unknown as InviteOctokit, req, reason)
		);
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Deny failed' };
	}
}
