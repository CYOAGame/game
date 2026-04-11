import { describe, it, expect } from 'vitest';
import {
	listJoinRequestsImpl,
	approveJoinRequestImpl,
	denyJoinRequestImpl,
	JOIN_REQUEST_LABEL,
	type JoinRequest,
	type InviteOctokit
} from '../../src/lib/invites/invite-client';

function makeFakeOctokit(overrides: Partial<InviteOctokit['rest']> = {}): InviteOctokit {
	const calls: Array<{ method: string; args: any }> = [];

	// Wrap override functions so they still push to the shared calls array
	function wrapOverrides<T extends Record<string, (...args: any[]) => any>>(
		obj: T | undefined
	): Partial<T> {
		if (!obj) return {};
		const wrapped: Partial<T> = {};
		for (const [method, fn] of Object.entries(obj)) {
			(wrapped as any)[method] = async (params: any) => {
				calls.push({ method, args: params });
				return fn(params);
			};
		}
		return wrapped;
	}

	const fake: InviteOctokit = {
		rest: {
			issues: {
				async listForRepo(params: any) {
					calls.push({ method: 'listForRepo', args: params });
					return { data: [] };
				},
				async createComment(params: any) {
					calls.push({ method: 'createComment', args: params });
					return { data: {} };
				},
				async update(params: any) {
					calls.push({ method: 'update', args: params });
					return { data: {} };
				},
				...wrapOverrides(overrides.issues as any)
			},
			repos: {
				async addCollaborator(params: any) {
					calls.push({ method: 'addCollaborator', args: params });
					return { data: {} };
				},
				...wrapOverrides(overrides.repos as any)
			}
		}
	};
	(fake as any).__calls = calls;
	return fake;
}

describe('listJoinRequestsImpl', () => {
	it('filters out pull_request items', async () => {
		const fake = makeFakeOctokit({
			issues: {
				async listForRepo() {
					return {
						data: [
							{
								number: 1,
								user: { login: 'alice', avatar_url: 'https://x/1.png' },
								created_at: '2026-04-11T10:00:00Z',
								pull_request: undefined
							},
							{
								number: 2,
								user: { login: 'bob', avatar_url: 'https://x/2.png' },
								created_at: '2026-04-11T11:00:00Z',
								pull_request: { url: 'https://api.github.com/repos/foo/bar/pulls/2' }
							}
						]
					};
				}
			} as any
		});
		const result = await listJoinRequestsImpl(fake, 'CYOAGame', 'Public_Game');
		expect(result).toHaveLength(1);
		expect(result[0].username).toBe('alice');
	});

	it('uses the correct label in the API call', async () => {
		let capturedParams: any = null;
		const fake = makeFakeOctokit({
			issues: {
				async listForRepo(params: any) {
					capturedParams = params;
					return { data: [] };
				}
			} as any
		});
		await listJoinRequestsImpl(fake, 'CYOAGame', 'Public_Game');
		expect(capturedParams.labels).toBe('journal-rpg/join-request');
		expect(capturedParams.state).toBe('open');
		expect(capturedParams.owner).toBe('CYOAGame');
		expect(capturedParams.repo).toBe('Public_Game');
	});

	it('maps issue.user.login to JoinRequest.username', async () => {
		const fake = makeFakeOctokit({
			issues: {
				async listForRepo() {
					return {
						data: [
							{
								number: 42,
								user: { login: 'charlie', avatar_url: 'https://x/c.png' },
								created_at: '2026-04-11T12:00:00Z'
							}
						]
					};
				}
			} as any
		});
		const result = await listJoinRequestsImpl(fake, 'CYOAGame', 'Public_Game');
		expect(result[0]).toEqual({
			issueNumber: 42,
			username: 'charlie',
			avatarUrl: 'https://x/c.png',
			submittedAt: '2026-04-11T12:00:00Z',
			repoOwner: 'CYOAGame',
			repoName: 'Public_Game'
		});
	});
});

const sampleRequest: JoinRequest = {
	issueNumber: 7,
	username: 'alice',
	avatarUrl: 'https://x/a.png',
	submittedAt: '2026-04-11T10:00:00Z',
	repoOwner: 'CYOAGame',
	repoName: 'Public_Game'
};

describe('approveJoinRequestImpl', () => {
	it('calls addCollaborator, then createComment, then update(state:closed) in order', async () => {
		const fake = makeFakeOctokit();
		const result = await approveJoinRequestImpl(fake, sampleRequest);
		const calls = (fake as any).__calls;
		expect(calls.map((c: any) => c.method)).toEqual(['addCollaborator', 'createComment', 'update']);
		expect(calls[0].args.username).toBe('alice');
		expect(calls[0].args.permission).toBe('push');
		expect(calls[1].args.issue_number).toBe(7);
		expect(calls[2].args.state).toBe('closed');
		expect(result.success).toBe(true);
	});

	it('stops early if addCollaborator throws 403', async () => {
		const fake = makeFakeOctokit({
			repos: {
				async addCollaborator() {
					const err: any = new Error('Forbidden');
					err.status = 403;
					throw err;
				}
			} as any
		});
		const result = await approveJoinRequestImpl(fake, sampleRequest);
		const calls = (fake as any).__calls;
		expect(calls.map((c: any) => c.method)).toEqual(['addCollaborator']);
		expect(result.success).toBe(false);
		expect(result.error).toContain('admin');
	});

	it('proceeds on addCollaborator 422 (already-a-collaborator)', async () => {
		const fake = makeFakeOctokit({
			repos: {
				async addCollaborator() {
					const err: any = new Error('Already a collaborator');
					err.status = 422;
					throw err;
				}
			} as any
		});
		const result = await approveJoinRequestImpl(fake, sampleRequest);
		const calls = (fake as any).__calls;
		expect(calls.map((c: any) => c.method)).toEqual(['addCollaborator', 'createComment', 'update']);
		expect(result.success).toBe(true);
	});

	it('returns success even if comment/close fail after successful add', async () => {
		const fake = makeFakeOctokit({
			issues: {
				async listForRepo() { return { data: [] }; },
				async createComment() {
					throw new Error('Comment failed');
				},
				async update() {
					throw new Error('Update failed');
				}
			} as any
		});
		const result = await approveJoinRequestImpl(fake, sampleRequest);
		// add succeeded, post-hooks failed — still success
		expect(result.success).toBe(true);
	});
});

describe('denyJoinRequestImpl', () => {
	it('calls createComment then update(state:closed)', async () => {
		const fake = makeFakeOctokit();
		const result = await denyJoinRequestImpl(fake, sampleRequest, 'not now');
		const calls = (fake as any).__calls;
		expect(calls.map((c: any) => c.method)).toEqual(['createComment', 'update']);
		expect(calls[0].args.body).toContain('not now');
		expect(calls[1].args.state).toBe('closed');
		expect(result.success).toBe(true);
	});

	it('uses a default message when no reason provided', async () => {
		const fake = makeFakeOctokit();
		await denyJoinRequestImpl(fake, sampleRequest);
		const calls = (fake as any).__calls;
		expect(calls[0].args.body.length).toBeGreaterThan(0);
	});
});

describe('JOIN_REQUEST_LABEL', () => {
	it('equals journal-rpg/join-request', () => {
		expect(JOIN_REQUEST_LABEL).toBe('journal-rpg/join-request');
	});
});
