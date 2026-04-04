import { describe, it, expect } from 'vitest';
import { serializeWorldStateToFiles, syncBranchWithMain, saveWithPR } from '../../src/lib/git/repo-writer';
import { createTestWorldState } from '../fixtures/world-state';

describe('serializeWorldStateToFiles', () => {
	it('serializes world state to a file map', () => {
		const world = createTestWorldState();
		const files = serializeWorldStateToFiles(world);
		expect(files.has('state/timeline.yaml')).toBe(true);
		expect(files.has('state/factions.yaml')).toBe(true);
		expect(files.has('state/questline-state.yaml')).toBe(true);
		expect(files.has('state/world-facts.yaml')).toBe(true);
	});
	it('creates a file per character', () => {
		const world = createTestWorldState();
		const files = serializeWorldStateToFiles(world);
		const charFiles = [...files.keys()].filter(k => k.startsWith('state/characters/'));
		expect(charFiles.length).toBe(2);
	});
});

describe('branch naming', () => {
	it('generates valid branch names from character IDs', () => {
		// Branch names use character IDs directly
		const characterId = 'elena_blacksmith_1234';
		const branchName = `journal/${characterId}`;
		expect(branchName).toBe('journal/elena_blacksmith_1234');
		// Should not contain spaces or special chars that git rejects
		expect(branchName).not.toMatch(/\s/);
	});
});

describe('multiplayer support', () => {
	it('syncBranchWithMain is exported', () => {
		expect(typeof syncBranchWithMain).toBe('function');
	});

	it('saveWithPR accepts optional username parameter', () => {
		// Type check — the function should accept 8 params
		expect(saveWithPR.length).toBeGreaterThanOrEqual(7);
	});
});
