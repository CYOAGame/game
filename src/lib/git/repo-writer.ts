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
