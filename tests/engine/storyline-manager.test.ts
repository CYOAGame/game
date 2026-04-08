import { describe, it, expect } from 'vitest';
import {
	updateTension,
	escalateStorylines,
	generateHooks,
	tensionToUrgency
} from '../../src/lib/engine/storyline-manager';
import { createTestWorldState } from '../fixtures/world-state';
import type { EventTemplate } from '../../src/lib/types/blocks';
import type { StorylineState } from '../../src/lib/types/storyline';

describe('tensionToUrgency', () => {
	it('returns calm for 0-25', () => {
		expect(tensionToUrgency(0)).toBe('calm');
		expect(tensionToUrgency(25)).toBe('calm');
	});
	it('returns stirring for 26-50', () => {
		expect(tensionToUrgency(30)).toBe('stirring');
		expect(tensionToUrgency(50)).toBe('stirring');
	});
	it('returns urgent for 51-80', () => {
		expect(tensionToUrgency(60)).toBe('urgent');
	});
	it('returns critical for 81+', () => {
		expect(tensionToUrgency(90)).toBe('critical');
	});
});

describe('updateTension', () => {
	it('increases tension for unplayed storylines', () => {
		const state: StorylineState = {
			currentChapter: 1, tension: 10,
			lastPlayerSession: null, lastEscalationDate: null, npcDriverId: null
		};
		const updated = updateTension(state, false);
		expect(updated.tension).toBeGreaterThan(10);
		expect(updated.tension).toBeLessThanOrEqual(25);
	});

	it('increases faster for player-engaged storylines', () => {
		const engaged: StorylineState = {
			currentChapter: 1, tension: 10,
			lastPlayerSession: 'entry_123', lastEscalationDate: null, npcDriverId: null
		};
		const unengaged: StorylineState = {
			currentChapter: 1, tension: 10,
			lastPlayerSession: null, lastEscalationDate: null, npcDriverId: null
		};
		let engagedTotal = 0, unengagedTotal = 0;
		for (let i = 0; i < 100; i++) {
			engagedTotal += updateTension(engaged, false).tension - 10;
			unengagedTotal += updateTension(unengaged, false).tension - 10;
		}
		expect(engagedTotal).toBeGreaterThan(unengagedTotal);
	});

	it('caps tension at 100', () => {
		const state: StorylineState = {
			currentChapter: 1, tension: 95,
			lastPlayerSession: null, lastEscalationDate: null, npcDriverId: null
		};
		const updated = updateTension(state, false);
		expect(updated.tension).toBeLessThanOrEqual(100);
	});

	it('resets tension for currently played storyline', () => {
		const state: StorylineState = {
			currentChapter: 1, tension: 50,
			lastPlayerSession: 'entry_123', lastEscalationDate: null, npcDriverId: null
		};
		const updated = updateTension(state, true);
		expect(updated.tension).toBe(0);
	});
});

describe('generateHooks', () => {
	it('returns hooks from eligible events', () => {
		const world = createTestWorldState();
		const events: EventTemplate[] = [{
			id: 'test_event', name: 'Test Event', tags: ['social'],
			preconditions: [], roles: [], entryNodeId: 'start',
			nodes: { start: { id: 'start', text: 'Something happens in the market today.', choices: [] } }
		}];
		const hooks = generateHooks(events, world, 'spring', 'elena_blacksmith', []);
		expect(hooks.length).toBeGreaterThan(0);
		expect(hooks[0].teaserText).toContain('Something happens');
	});

	it('groups storyline events and picks most advanced chapter', () => {
		const world = createTestWorldState();
		world.storylineStates = {
			test_story: { currentChapter: 2, tension: 30, lastPlayerSession: null, lastEscalationDate: null, npcDriverId: null }
		};
		const events: EventTemplate[] = [
			{
				id: 'ch1', name: 'Chapter 1', tags: [], preconditions: [],
				roles: [], entryNodeId: 'start',
				nodes: { start: { id: 'start', text: 'Chapter 1 text.', choices: [] } },
				storyline: 'test_story', chapter: 1
			},
			{
				id: 'ch2', name: 'Chapter 2', tags: [], preconditions: [],
				roles: [], entryNodeId: 'start',
				nodes: { start: { id: 'start', text: 'Chapter 2 text.', choices: [] } },
				storyline: 'test_story', chapter: 2
			}
		];
		const hooks = generateHooks(events, world, 'spring', 'elena_blacksmith', []);
		const storyHooks = hooks.filter(h => h.storyline === 'test_story');
		expect(storyHooks).toHaveLength(1);
		expect(storyHooks[0].eventId).toBe('ch2');
	});
});
