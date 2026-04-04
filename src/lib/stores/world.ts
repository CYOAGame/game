import { writable, derived } from 'svelte/store';
import type { WorldState } from '../types/state';
import type { WorldBlocks } from '../engine/world-loader';

export const worldState = writable<WorldState | null>(null);
export const worldBlocks = writable<WorldBlocks | null>(null);

export const livingCharacters = derived(worldState, ($state) =>
	$state?.characters.filter(c => c.alive) ?? []
);

export const currentQuestlineStages = derived([worldState, worldBlocks], ([$state, $blocks]) => {
	if (!$state || !$blocks) return [];
	return $state.questlineProgress.map(progress => {
		const questline = $blocks.questlines.find(q => q.id === progress.questlineId);
		return {
			questlineId: progress.questlineId,
			questlineName: questline?.name ?? progress.questlineId,
			stage: questline?.stages[progress.currentStageIndex],
			stageIndex: progress.currentStageIndex
		};
	});
});
