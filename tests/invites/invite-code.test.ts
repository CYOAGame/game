import { describe, it, expect } from 'vitest';
import { encodeInviteCode, decodeInviteCode } from '../../src/lib/invites/invite-code';

describe('encodeInviteCode', () => {
	it('encodes repo and token into a base64 string', () => {
		const code = encodeInviteCode('ironhaven', 'github_pat_abc123');
		expect(typeof code).toBe('string');
		expect(code.length).toBeGreaterThan(0);
		expect(code).not.toContain('github_pat_abc123');
	});

	it('produces a string safe for URLs', () => {
		const code = encodeInviteCode('ironhaven', 'github_pat_abc123+/=');
		expect(code).not.toMatch(/[+/=]/);
	});
});

describe('decodeInviteCode', () => {
	it('decodes back to original repo and token', () => {
		const code = encodeInviteCode('ironhaven', 'github_pat_abc123');
		const result = decodeInviteCode(code);
		expect(result).toEqual({ repo: 'ironhaven', token: 'github_pat_abc123' });
	});

	it('returns null for invalid base64', () => {
		const result = decodeInviteCode('not-valid!!!');
		expect(result).toBeNull();
	});

	it('returns null for valid base64 but wrong structure', () => {
		const code = btoa(JSON.stringify({ foo: 'bar' }));
		const result = decodeInviteCode(code);
		expect(result).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(decodeInviteCode('')).toBeNull();
	});
});
