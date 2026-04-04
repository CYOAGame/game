import { describe, it, expect } from 'vitest';
import { filterEvents, weightEvents, selectEvent } from '../../src/lib/engine/event-selector';
import { banditRaid, harvestFestival, allEvents } from '../fixtures/events';
import { demonInvasion, allQuestlines } from '../fixtures/questlines';
import { createTestWorldState } from '../fixtures/world-state';

describe('filterEvents', () => {
	it('filters events by questline stage preconditions', () => {
		const world = createTestWorldState();
		// Stage 0 = "gathering", bandit_raid requires "border_falls" (stage 2)
		const filtered = filterEvents(allEvents, world, 'autumn', allQuestlines);

		expect(filtered.map(e => e.id)).toContain('harvest_festival');
		expect(filtered.map(e => e.id)).not.toContain('bandit_raid');
	});

	it('includes events when questline stage matches', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 2; // border_falls
		const filtered = filterEvents(allEvents, world, 'autumn', allQuestlines);

		expect(filtered.map(e => e.id)).toContain('bandit_raid');
		expect(filtered.map(e => e.id)).toContain('harvest_festival');
	});

	it('filters events by season', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 2;
		const filtered = filterEvents(allEvents, world, 'spring', allQuestlines);

		expect(filtered.map(e => e.id)).toContain('bandit_raid');
		expect(filtered.map(e => e.id)).not.toContain('harvest_festival');
	});
});

describe('weightEvents', () => {
	it('boosts events matching player day-type preferences', () => {
		const preferences = ['action', 'combat'];
		const events = [banditRaid, harvestFestival];
		const weighted = weightEvents(events, preferences);

		const raidWeight = weighted.find(w => w.event.id === 'bandit_raid')!.weight;
		const festivalWeight = weighted.find(w => w.event.id === 'harvest_festival')!.weight;

		expect(raidWeight).toBeGreaterThan(festivalWeight);
	});

	it('gives all events a base weight even with no matching preferences', () => {
		const weighted = weightEvents([banditRaid, harvestFestival], []);

		for (const w of weighted) {
			expect(w.weight).toBeGreaterThan(0);
		}
	});
});

describe('selectEvent', () => {
	it('returns an event from the available pool', () => {
		const world = createTestWorldState();
		world.questlineProgress[0].currentStageIndex = 2;
		const selected = selectEvent(allEvents, world, 'autumn', ['action'], allQuestlines);

		expect(selected).toBeTruthy();
		expect(['bandit_raid', 'harvest_festival']).toContain(selected!.id);
	});

	it('returns null when no events match', () => {
		const world = createTestWorldState();
		// Stage 0 + spring = nothing matches
		const selected = selectEvent(allEvents, world, 'spring', [], allQuestlines);

		expect(selected).toBeNull();
	});
});
