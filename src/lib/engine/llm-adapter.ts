import type { PlayerPrefs } from '../stores/player';

export interface LLMContext {
	characterName: string;
	characterArchetype: string;
	locationName?: string;
	season?: string;
	timeContext?: 'past' | 'present' | 'future';
	previousChoices?: string[];
	previousNarrative?: string[];
	lastChoice?: string;
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
			let model = prefs.llmModel || '';
			if (!model) {
				model = await detectLocalModel(endpoint);
				console.log('[LLM] Auto-detected model:', model);
			}
			return await callLocalLLM(systemPrompt, userPrompt, endpoint, model);
		}
		if (prefs.llmSetting === 'claude') {
			return await callClaudeAPI(systemPrompt, userPrompt, prefs.llmApiKey ?? '');
		}
	} catch (err) {
		console.warn('[LLM] Enhancement failed:', err);
		return templateText;
	}

	return templateText;
}

function buildSystemPrompt(context: LLMContext): string {
	let prompt = `You rewrite passages for a medieval journal RPG. Rules:
- First person, past tense
- 2-4 sentences only. Be concise.
- Keep the EXACT same events, characters, and meaning. Do not invent anything.
- The rewrite must flow naturally from what came before.
- Never use em dashes.`;

	if (context.timeContext === 'past') {
		prompt += `\nThis is a memory from the past.`;
	} else if (context.timeContext === 'future') {
		prompt += `\nThis takes place in the future.`;
	}

	return prompt;
}

function buildUserPrompt(templateText: string, context: LLMContext): string {
	let prompt = `I am ${context.characterName} the ${context.characterArchetype}.`;
	if (context.locationName) prompt += ` I am in ${context.locationName}.`;
	if (context.season) prompt += ` It is ${context.season}.`;
	prompt += `\n\n`;

	// Include narrative history so the LLM has continuity
	if (context.previousNarrative?.length) {
		prompt += `What has happened so far in this entry:\n`;
		for (const text of context.previousNarrative.slice(-4)) {
			prompt += `"${text}"\n`;
		}
		prompt += `\n`;
	}

	if (context.lastChoice) {
		prompt += `I just chose: "${context.lastChoice}"\n\n`;
	}

	prompt += `Rewrite this next passage to flow naturally from the above. Same events, same meaning, just better prose:\n"${templateText}"\n\nRewritten:`;
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
			const models = data.data ?? [];
			if (models.length === 0) return 'default';
			// Prefer larger models (sort by name descending to pick bigger variants)
			// Common pattern: qwen3:8b > gemma3:1b
			const sorted = [...models].sort((a: any, b: any) => {
				const sizeA = parseModelSize(a.id);
				const sizeB = parseModelSize(b.id);
				return sizeB - sizeA;
			});
			return sorted[0]?.id ?? models[0]?.id ?? 'default';
		}
	} catch {
		// ignore
	}
	return 'default';
}

function parseModelSize(modelId: string): number {
	const match = modelId.match(/:(\d+)b/i);
	if (match) return parseInt(match[1]);
	const match2 = modelId.match(/(\d+)b/i);
	if (match2) return parseInt(match2[1]);
	return 0;
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
			max_tokens: 300,
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
			max_tokens: 300,
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
