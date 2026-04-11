import { describe, it, expect } from 'vitest';
import { buildJoinRequestUrl } from '../../src/lib/invites/invite-url';

describe('buildJoinRequestUrl', () => {
	it('returns a github.com issues/new URL', () => {
		const url = buildJoinRequestUrl('CYOAGame', 'Public_Game', 'https://cyoagame.github.io/game/');
		expect(url.startsWith('https://github.com/CYOAGame/Public_Game/issues/new')).toBe(true);
	});

	it('includes the join-request label', () => {
		const url = buildJoinRequestUrl('CYOAGame', 'Public_Game', 'https://cyoagame.github.io/game/');
		// Label is url-encoded: journal-rpg%2Fjoin-request
		expect(url).toContain('labels=journal-rpg%2Fjoin-request');
	});

	it('includes a title', () => {
		const url = buildJoinRequestUrl('CYOAGame', 'Public_Game', 'https://cyoagame.github.io/game/');
		expect(url).toContain('title=Join+request');
	});

	it('includes the app URL in the body', () => {
		const url = buildJoinRequestUrl('CYOAGame', 'Public_Game', 'https://cyoagame.github.io/game/');
		// Body contains the encoded appUrl somewhere
		expect(url).toContain('https%3A%2F%2Fcyoagame.github.io%2Fgame%2F');
	});

	it('handles owners with hyphens', () => {
		const url = buildJoinRequestUrl('cool-org', 'my-world', 'https://example.com/');
		expect(url.startsWith('https://github.com/cool-org/my-world/issues/new')).toBe(true);
	});

	it('returns a string (never throws) for edge inputs', () => {
		expect(typeof buildJoinRequestUrl('', '', '')).toBe('string');
	});
});
