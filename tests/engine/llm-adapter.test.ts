import { describe, it, expect } from 'vitest';
import { enhanceText, type LLMContext } from '../../src/lib/engine/llm-adapter';
import type { PlayerPrefs } from '../../src/lib/stores/player';

const testContext: LLMContext = {
	characterName: 'Elena',
	characterArchetype: 'blacksmith',
	season: 'spring'
};

describe('enhanceText', () => {
	it('returns original text when llmSetting is none', async () => {
		const prefs: PlayerPrefs = { dayTypePreferences: [], llmSetting: 'none' };
		const result = await enhanceText('The forge burns hot.', testContext, prefs);
		expect(result).toBe('The forge burns hot.');
	});

	it('returns original text when local LLM is unreachable', async () => {
		const prefs: PlayerPrefs = {
			dayTypePreferences: [],
			llmSetting: 'local',
			llmEndpoint: 'http://localhost:99999/v1'
		};
		const result = await enhanceText('The forge burns hot.', testContext, prefs);
		expect(result).toBe('The forge burns hot.');
	});

	it('returns original text when claude API key is missing', async () => {
		const prefs: PlayerPrefs = {
			dayTypePreferences: [],
			llmSetting: 'claude',
			llmApiKey: ''
		};
		const result = await enhanceText('The forge burns hot.', testContext, prefs);
		expect(result).toBe('The forge burns hot.');
	});
});
