import { describe, it, expect } from 'vitest';
import { checkAdvancement, checkRegression, updateQuestlines } from '../../src/lib/engine/questline-tracker';
import { demonInvasion } from '../fixtures/questlines';
import { createTestWorldState } from '../fixtures/world-state';

describe('checkAdvancement', () => {
	it('advances when all triggers are met', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].counters.border_incidents = 5;
		expect(checkAdvancement(world.questlineProgress[0], demonInvasion)).toBe(true);
	});

	it('does not advance when triggers are not met', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].counters.border_incidents = 3;
		expect(checkAdvancement(world.questlineProgress[0], demonInvasion)).toBe(false);
	});

	it('does not advance past the last stage', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 3;
		expect(checkAdvancement(world.questlineProgress[0], demonInvasion)).toBe(false);
	});
});

describe('checkRegression', () => {
	it('regresses when regression triggers are met', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 1;
		world.questlineProgress[0].counters.border_failures = 5;
		expect(checkRegression(world.questlineProgress[0], demonInvasion)).toBe(true);
	});

	it('does not regress below stage 0', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 0;
		expect(checkRegression(world.questlineProgress[0], demonInvasion)).toBe(false);
	});
});

describe('updateQuestlines', () => {
	it('advances the questline stage and resets counters', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].counters.border_incidents = 5;
		const updated = updateQuestlines(world.questlineProgress, [demonInvasion]);
		expect(updated[0].currentStageIndex).toBe(1);
	});

	it('returns unchanged progress when no triggers are met', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].counters.border_incidents = 2;
		const updated = updateQuestlines(world.questlineProgress, [demonInvasion]);
		expect(updated[0].currentStageIndex).toBe(0);
	});
});
