import { describe, it, expect } from 'vitest';
import { parseRepoUrl } from '../../src/lib/git/github-client';

describe('parseRepoUrl', () => {
	it('parses a full GitHub URL', () => {
		expect(parseRepoUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
	});
	it('parses owner/repo shorthand', () => {
		expect(parseRepoUrl('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
	});
	it('strips trailing slashes and .git', () => {
		expect(parseRepoUrl('https://github.com/owner/repo.git/')).toEqual({ owner: 'owner', repo: 'repo' });
	});
	it('returns null for invalid URLs', () => {
		expect(parseRepoUrl('')).toBeNull();
		expect(parseRepoUrl('not-a-url')).toBeNull();
		expect(parseRepoUrl('https://github.com/')).toBeNull();
	});
});
