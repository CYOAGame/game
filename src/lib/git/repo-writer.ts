import yaml from 'js-yaml';
import type { WorldState } from '../types/state';
import { getOctokit } from './github-client';

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
		const octokit = getOctokit(token);

		// 1. GET ref
		const refInfo = await resolveRef(octokit, owner, repo);
		if (!refInfo) return { success: false, error: 'Could not find main or master branch' };

		// 2. GET commit to get tree sha
		const { data: commitData } = await octokit.rest.git.getCommit({
			owner, repo, commit_sha: refInfo.sha
		});
		const baseTreeSha = commitData.tree.sha;

		// 3. Create blobs for each file
		const treeEntries = await Promise.all(
			[...files.entries()].map(async ([path, content]) => {
				const { data: blob } = await octokit.rest.git.createBlob({
					owner, repo,
					content,
					encoding: 'utf-8'
				});
				return {
					path,
					mode: '100644' as const,
					type: 'blob' as const,
					sha: blob.sha
				};
			})
		);

		// 4. Create tree
		const { data: newTree } = await octokit.rest.git.createTree({
			owner, repo,
			base_tree: baseTreeSha,
			tree: treeEntries
		});

		// 5. Create commit
		const { data: newCommit } = await octokit.rest.git.createCommit({
			owner, repo,
			message,
			tree: newTree.sha,
			parents: [refInfo.sha]
		});

		// 6. Update ref
		await octokit.rest.git.updateRef({
			owner, repo,
			ref: refInfo.ref,
			sha: newCommit.sha
		});

		return { success: true, sha: newCommit.sha };
	} catch (err) {
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

	// Check if branch already exists
	try {
		const { data } = await octokit.rest.git.getRef({ owner, repo, ref });
		return { ref, sha: data.object.sha };
	} catch {
		// Branch doesn't exist — create from main
	}

	// Get main HEAD
	const mainRef = await resolveRef(octokit, owner, repo);
	if (!mainRef) return null;

	try {
		const { data } = await octokit.rest.git.createRef({
			owner, repo,
			ref: `refs/${ref}`,
			sha: mainRef.sha
		});
		return { ref, sha: data.object.sha };
	} catch (err) {
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
		const octokit = getOctokit(token);

		// Ensure branch exists
		const branch = await ensureBranch(token, owner, repo, characterId);
		if (!branch) return { success: false, error: 'Could not create or find branch' };

		// Get current commit on branch
		const { data: commitData } = await octokit.rest.git.getCommit({
			owner, repo, commit_sha: branch.sha
		});
		const baseTreeSha = commitData.tree.sha;

		// Create blobs
		const treeEntries = await Promise.all(
			[...files.entries()].map(async ([path, content]) => {
				const { data: blob } = await octokit.rest.git.createBlob({
					owner, repo, content, encoding: 'utf-8'
				});
				return { path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
			})
		);

		// Create tree
		const { data: newTree } = await octokit.rest.git.createTree({
			owner, repo, base_tree: baseTreeSha, tree: treeEntries
		});

		// Create commit on branch
		const { data: newCommit } = await octokit.rest.git.createCommit({
			owner, repo, message, tree: newTree.sha, parents: [branch.sha]
		});

		// Update branch ref
		await octokit.rest.git.updateRef({
			owner, repo, ref: branch.ref, sha: newCommit.sha
		});

		return { success: true, sha: newCommit.sha };
	} catch (err) {
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
	const octokit = getOctokit(token);
	const branchName = `journal/${characterId}`;

	// Check for existing open PR
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

	// Create PR
	try {
		const { data: pr } = await octokit.rest.pulls.create({
			owner, repo,
			title: `Journal: ${characterName}`,
			body: `Ongoing journal entries for ${characterName}.\n\nThis PR is auto-managed by the Journal RPG game. Each commit represents one journal entry (one day).`,
			head: branchName,
			base: 'main'
		});
		return { prNumber: pr.number };
	} catch (err: any) {
		// If base is master not main, try that
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
	const octokit = getOctokit(token);
	const branchName = `journal/${characterId}`;

	try {
		// Try merge via the merge API (simpler than PR merge)
		await octokit.rest.repos.merge({
			owner, repo,
			base: 'main',
			head: branchName,
			commit_message: `Merge journal/${characterId}`
		});
		return { success: true };
	} catch (err: any) {
		// Try master
		try {
			await octokit.rest.repos.merge({
				owner, repo,
				base: 'master',
				head: branchName,
				commit_message: `Merge journal/${characterId}`
			});
			return { success: true };
		} catch (err2: any) {
			// 409 = nothing to merge (already up to date) — that's fine
			if (err2.status === 409 || err.status === 409) return { success: true };
			return { success: false, error: err2.message ?? err.message ?? 'Merge failed' };
		}
	}
}

/**
 * Full save flow: commit to branch → ensure PR → merge to main.
 */
export async function saveWithPR(
	token: string,
	owner: string,
	repo: string,
	characterId: string,
	characterName: string,
	files: Map<string, string>,
	commitMessage: string
): Promise<{ success: boolean; sha?: string; prNumber?: number; error?: string }> {
	// 1. Commit to character branch
	const commitResult = await commitToBranch(token, owner, repo, characterId, files, commitMessage);
	if (!commitResult.success) {
		return { success: false, error: commitResult.error };
	}

	// 2. Ensure PR exists
	const prResult = await ensurePR(token, owner, repo, characterId, characterName);

	// 3. Auto-merge to main
	const mergeResult = await mergeBranchToMain(token, owner, repo, characterId);
	if (!mergeResult.success) {
		// Commit succeeded but merge failed — not critical, PR is still there
		return {
			success: true,
			sha: commitResult.sha,
			prNumber: prResult?.prNumber,
			error: `Committed but merge failed: ${mergeResult.error}`
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
