import yaml from 'js-yaml';
import type { WorldState } from '../types/state';
import { getOctokit, handleRequest } from './github-client';
import { AuthExpiredError } from './auth-errors';

const PENDING_KEY = 'journal-rpg-pending-commits';

export function serializeWorldStateToFiles(state: WorldState): Map<string, string> {
	const files = new Map<string, string>();

	// One file per character
	for (const character of state.characters) {
		files.set(`state/characters/${character.id}.yaml`, yaml.dump(character));
	}

	// Timeline
	files.set('state/timeline.yaml', yaml.dump(state.timeline));

	// Factions
	files.set('state/factions.yaml', yaml.dump(state.factions));

	// Questline state
	files.set('state/questline-state.yaml', yaml.dump(state.questlineProgress));

	// Locations
	files.set('state/locations.yaml', yaml.dump(state.locations));

	// World facts
	files.set('state/world-facts.yaml', yaml.dump(state.worldFacts));

	// Played character ids
	files.set('state/played-characters.yaml', yaml.dump(state.playedCharacterIds));

	// Recent event ids
	files.set('state/recent-events.yaml', yaml.dump(state.recentEventIds));

	// Storyline states
	files.set('state/storylines.yaml', yaml.dump(state.storylineStates ?? {}));

	return files;
}

async function resolveRef(
	octokit: ReturnType<typeof getOctokit>,
	owner: string,
	repo: string
): Promise<{ ref: string; sha: string } | null> {
	for (const branch of ['heads/main', 'heads/master']) {
		try {
			const { data } = await octokit.rest.git.getRef({ owner, repo, ref: branch });
			return { ref: branch, sha: data.object.sha };
		} catch {
			// try next
		}
	}
	return null;
}

export async function commitFiles(
	token: string,
	owner: string,
	repo: string,
	files: Map<string, string>,
	message: string
): Promise<{ success: boolean; sha?: string; error?: string }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);

			const refInfo = await resolveRef(octokit, owner, repo);
			if (!refInfo) return { success: false, error: 'Could not find main or master branch' };

			const { data: commitData } = await octokit.rest.git.getCommit({
				owner, repo, commit_sha: refInfo.sha
			});
			const baseTreeSha = commitData.tree.sha;

			const treeEntries = await Promise.all(
				[...files.entries()].map(async ([path, content]) => {
					const { data: blob } = await octokit.rest.git.createBlob({
						owner, repo, content, encoding: 'utf-8'
					});
					return {
						path,
						mode: '100644' as const,
						type: 'blob' as const,
						sha: blob.sha
					};
				})
			);

			const { data: newTree } = await octokit.rest.git.createTree({
				owner, repo,
				base_tree: baseTreeSha,
				tree: treeEntries
			});

			const { data: newCommit } = await octokit.rest.git.createCommit({
				owner, repo,
				message,
				tree: newTree.sha,
				parents: [refInfo.sha]
			});

			await octokit.rest.git.updateRef({
				owner, repo,
				ref: refInfo.ref,
				sha: newCommit.sha
			});

			return { success: true, sha: newCommit.sha };
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		const message = err instanceof Error ? err.message : 'Unknown error';
		return { success: false, error: message };
	}
}

/**
 * Ensure a branch exists for a character. Creates it from main's HEAD if it doesn't exist.
 * Returns the branch ref name.
 */
export async function ensureBranch(
	token: string,
	owner: string,
	repo: string,
	characterId: string
): Promise<{ ref: string; sha: string } | null> {
	const octokit = getOctokit(token);
	const branchName = `journal/${characterId}`;
	const ref = `heads/${branchName}`;

	try {
		return await handleRequest(async () => {
			try {
				const { data } = await octokit.rest.git.getRef({ owner, repo, ref });
				return { ref, sha: data.object.sha };
			} catch {
				// fall through to create
			}
			const mainRef = await resolveRef(octokit, owner, repo);
			if (!mainRef) return null;
			try {
				const { data } = await octokit.rest.git.createRef({
					owner, repo,
					ref: `refs/${ref}`,
					sha: mainRef.sha
				});
				return { ref, sha: data.object.sha };
			} catch {
				return null;
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return null;
	}
}

/**
 * Commit files to a character's branch (not main).
 */
export async function commitToBranch(
	token: string,
	owner: string,
	repo: string,
	characterId: string,
	files: Map<string, string>,
	message: string
): Promise<{ success: boolean; sha?: string; error?: string }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);

			const branch = await ensureBranch(token, owner, repo, characterId);
			if (!branch) return { success: false, error: 'Could not create or find branch' };

			const { data: commitData } = await octokit.rest.git.getCommit({
				owner, repo, commit_sha: branch.sha
			});
			const baseTreeSha = commitData.tree.sha;

			const treeEntries = await Promise.all(
				[...files.entries()].map(async ([path, content]) => {
					const { data: blob } = await octokit.rest.git.createBlob({
						owner, repo, content, encoding: 'utf-8'
					});
					return { path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
				})
			);

			const { data: newTree } = await octokit.rest.git.createTree({
				owner, repo, base_tree: baseTreeSha, tree: treeEntries
			});

			const { data: newCommit } = await octokit.rest.git.createCommit({
				owner, repo, message, tree: newTree.sha, parents: [branch.sha]
			});

			await octokit.rest.git.updateRef({
				owner, repo, ref: branch.ref, sha: newCommit.sha
			});

			return { success: true, sha: newCommit.sha };
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		const msg = err instanceof Error ? err.message : 'Unknown error';
		return { success: false, error: msg };
	}
}

/**
 * Ensure a PR exists from the character's branch to main.
 * Returns the PR number, creating one if needed.
 */
export async function ensurePR(
	token: string,
	owner: string,
	repo: string,
	characterId: string,
	characterName: string
): Promise<{ prNumber: number } | null> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const branchName = `journal/${characterId}`;

			try {
				const { data: prs } = await octokit.rest.pulls.list({
					owner, repo, head: `${owner}:${branchName}`, state: 'open'
				});
				if (prs.length > 0) {
					return { prNumber: prs[0].number };
				}
			} catch {
				// continue to create
			}

			try {
				const { data: pr } = await octokit.rest.pulls.create({
					owner, repo,
					title: `Journal: ${characterName}`,
					body: `Ongoing journal entries for ${characterName}.\n\nThis PR is auto-managed by the Journal RPG game. Each commit represents one journal entry (one day).`,
					head: branchName,
					base: 'main'
				});
				return { prNumber: pr.number };
			} catch {
				try {
					const { data: pr } = await octokit.rest.pulls.create({
						owner, repo,
						title: `Journal: ${characterName}`,
						body: `Ongoing journal entries for ${characterName}.\n\nThis PR is auto-managed by the Journal RPG game. Each commit represents one journal entry (one day).`,
						head: branchName,
						base: 'master'
					});
					return { prNumber: pr.number };
				} catch {
					return null;
				}
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return null;
	}
}

/**
 * Sync a branch with main — merge main into the branch to pick up other players' changes.
 * This ensures the branch is never behind main.
 */
export async function syncBranchWithMain(
	token: string,
	owner: string,
	repo: string,
	characterId: string
): Promise<{ success: boolean; error?: string }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const branchName = `journal/${characterId}`;
			try {
				await octokit.rest.repos.merge({
					owner, repo, base: branchName, head: 'main',
					commit_message: `Sync ${branchName} with main`
				});
				return { success: true };
			} catch (err: any) {
				if (err.status === 409) return { success: true };
				try {
					await octokit.rest.repos.merge({
						owner, repo, base: branchName, head: 'master',
						commit_message: `Sync ${branchName} with master`
					});
					return { success: true };
				} catch (err2: any) {
					if (err2.status === 409) return { success: true };
					// 401 will escape this inner catch and be caught by handleRequest above
					if (err2.status === 401 || err.status === 401) throw err2;
					return { success: false, error: err2.message ?? 'Branch sync failed' };
				}
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Branch sync failed' };
	}
}

/**
 * Merge the character's branch into main (fast-forward or merge commit).
 */
export async function mergeBranchToMain(
	token: string,
	owner: string,
	repo: string,
	characterId: string
): Promise<{ success: boolean; error?: string }> {
	try {
		return await handleRequest(async () => {
			const octokit = getOctokit(token);
			const branchName = `journal/${characterId}`;
			try {
				await octokit.rest.repos.merge({
					owner, repo, base: 'main', head: branchName,
					commit_message: `Merge journal/${characterId}`
				});
				return { success: true };
			} catch (err: any) {
				try {
					await octokit.rest.repos.merge({
						owner, repo, base: 'master', head: branchName,
						commit_message: `Merge journal/${characterId}`
					});
					return { success: true };
				} catch (err2: any) {
					if (err2.status === 409 || err.status === 409) return { success: true };
					if (err2.status === 401 || err.status === 401) throw err2;
					return { success: false, error: err2.message ?? err.message ?? 'Merge failed' };
				}
			}
		});
	} catch (err) {
		if (err instanceof AuthExpiredError) throw err;
		return { success: false, error: 'Merge failed' };
	}
}

/**
 * Full save flow: sync branch → commit to branch → ensure PR → merge to main (with retry).
 */
export async function saveWithPR(
	token: string,
	owner: string,
	repo: string,
	characterId: string,
	characterName: string,
	files: Map<string, string>,
	commitMessage: string,
	username?: string
): Promise<{ success: boolean; sha?: string; prNumber?: number; error?: string }> {
	// 0. Ensure branch exists
	const branch = await ensureBranch(token, owner, repo, characterId);
	if (!branch) return { success: false, error: 'Could not create branch' };

	// 1. Sync branch with main (pick up other players' changes)
	await syncBranchWithMain(token, owner, repo, characterId);

	// 2. Commit to character branch
	const finalMessage = username ? `[${username}] ${commitMessage}` : commitMessage;
	const commitResult = await commitToBranch(token, owner, repo, characterId, files, finalMessage);
	if (!commitResult.success) {
		return { success: false, error: commitResult.error };
	}

	// 3. Ensure PR exists
	const prResult = await ensurePR(token, owner, repo, characterId, characterName);

	// 4. Auto-merge to main with retry
	let mergeResult = await mergeBranchToMain(token, owner, repo, characterId);
	if (!mergeResult.success) {
		// Retry once: sync with main again, then merge
		await syncBranchWithMain(token, owner, repo, characterId);
		mergeResult = await mergeBranchToMain(token, owner, repo, characterId);
	}

	if (!mergeResult.success) {
		return {
			success: true,
			sha: commitResult.sha,
			prNumber: prResult?.prNumber,
			error: `Committed but merge failed: ${mergeResult.error}. Changes are on the branch and PR.`
		};
	}

	return {
		success: true,
		sha: commitResult.sha,
		prNumber: prResult?.prNumber
	};
}

export function queuePendingChanges(files: Map<string, string>, message: string): void {
	if (typeof localStorage === 'undefined') return;
	const existing = getPendingChanges();
	const fileRecord: Record<string, string> = {};
	for (const [k, v] of files) {
		fileRecord[k] = v;
	}
	existing.push({ files: fileRecord, message });
	localStorage.setItem(PENDING_KEY, JSON.stringify(existing));
}

export function getPendingChanges(): Array<{ files: Record<string, string>; message: string }> {
	if (typeof localStorage === 'undefined') return [];
	const raw = localStorage.getItem(PENDING_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as Array<{ files: Record<string, string>; message: string }>;
		// Clear after reading
		localStorage.removeItem(PENDING_KEY);
		return parsed;
	} catch {
		return [];
	}
}
