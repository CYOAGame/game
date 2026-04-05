import type { PlayerPrefs } from '../stores/player';

export interface LLMContext {
	characterName: string;
	characterArchetype: string;
	locationName?: string;
	season?: string;
	timeContext?: 'past' | 'present' | 'future';
	previousChoices?: string[];
	questlineStage?: string;
}

/**
 * Enhance template text with LLM-generated prose.
 * Returns the original text if LLM is disabled or fails.
 */
export async function enhanceText(
	templateText: string,
	context: LLMContext,
	prefs: PlayerPrefs
): Promise<string> {
	if (prefs.llmSetting === 'none') return templateText;

	const systemPrompt = buildSystemPrompt(context);
	const userPrompt = buildUserPrompt(templateText, context);

	try {
		if (prefs.llmSetting === 'local') {
			const endpoint = prefs.llmEndpoint ?? 'http://localhost:11434/v1';
			const model = prefs.llmModel || await detectLocalModel(endpoint);
			return await callLocalLLM(systemPrompt, userPrompt, endpoint, model);
		}
		if (prefs.llmSetting === 'claude') {
			return await callClaudeAPI(systemPrompt, userPrompt, prefs.llmApiKey ?? '');
		}
	} catch (err) {
		console.warn('LLM enhancement failed, using template text:', err);
		return templateText;
	}

	return templateText;
}

function buildSystemPrompt(context: LLMContext): string {
	let prompt = `You lightly polish journal entries for a medieval RPG. Rules:
- First person, past tense, plain language
- MAXIMUM 2 sentences. Never more.
- Keep the same meaning. Do not add characters, events, or details
- No flowery language, no purple prose, no metaphors
- Write like a tired person jotting notes, not a novelist
- Never use em dashes`;

	if (context.timeContext === 'past') {
		prompt += `\n- This is a memory. Keep it brief and matter-of-fact.`;
	} else if (context.timeContext === 'future') {
		prompt += `\n- This hasn't happened yet. Keep it uncertain and short.`;
	}

	return prompt;
}

function buildUserPrompt(templateText: string, context: LLMContext): string {
	let prompt = `Polish this text lightly. Keep it SHORT. Maximum 2 sentences. Same meaning, just slightly better wording.\n\n`;
	prompt += `Character: ${context.characterName} the ${context.characterArchetype}\n`;
	if (context.locationName) prompt += `Location: ${context.locationName}\n`;
	if (context.season) prompt += `Season: ${context.season}\n`;
	if (context.previousChoices?.length) {
		prompt += `Recent choices: ${context.previousChoices.slice(-3).join(', ')}\n`;
	}
	prompt += `\nOriginal text:\n"${templateText}"\n\nRewritten:`;
	return prompt;
}

/**
 * Call a local OpenAI-compatible API (Ollama, LM Studio, etc.)
 */
/**
 * Auto-detect the first available model from a local OpenAI-compatible API.
 */
async function detectLocalModel(endpoint: string): Promise<string> {
	try {
		let url = endpoint.replace(/\/+$/, '');
		if (url.endsWith('/chat/completions')) {
			url = url.replace('/chat/completions', '');
		}
		const response = await fetch(`${url}/models`);
		if (response.ok) {
			const data = await response.json();
			const firstModel = data.data?.[0]?.id;
			if (firstModel) return firstModel;
		}
	} catch {
		// ignore
	}
	return 'default';
}

async function callLocalLLM(systemPrompt: string, userPrompt: string, endpoint: string, model: string): Promise<string> {
	// Normalize endpoint — ensure it ends with /chat/completions
	let url = endpoint.replace(/\/+$/, '');
	if (!url.endsWith('/chat/completions')) {
		url += '/chat/completions';
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			max_tokens: 80,
			temperature: 0.8
		})
	});

	if (!response.ok) {
		throw new Error(`Local LLM returned ${response.status}`);
	}

	const data = await response.json();
	const content = data.choices?.[0]?.message?.content?.trim();
	if (!content) throw new Error('Empty response from local LLM');
	return content;
}

/**
 * Call the Anthropic Claude API directly from the browser.
 * Note: This requires CORS to be handled or a proxy. The Anthropic API
 * supports direct browser calls with the anthropic-dangerous-direct-browser-access header.
 */
async function callClaudeAPI(systemPrompt: string, userPrompt: string, apiKey: string): Promise<string> {
	if (!apiKey) throw new Error('No Claude API key configured');

	const response = await fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true'
		},
		body: JSON.stringify({
			model: 'claude-haiku-4-5-20251001',
			max_tokens: 80,
			system: systemPrompt,
			messages: [
				{ role: 'user', content: userPrompt }
			]
		})
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Claude API returned ${response.status}: ${errorText}`);
	}

	const data = await response.json();
	const content = data.content?.[0]?.text?.trim();
	if (!content) throw new Error('Empty response from Claude API');
	return content;
}
