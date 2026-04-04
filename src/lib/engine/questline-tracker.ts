import type { Questline, Trigger } from '../types/blocks';
import type { QuestlineProgress } from '../types/state';

function triggersAreMet(triggers: Trigger[], counters: Record<string, number>): boolean {
	if (triggers.length === 0) return false;
	return triggers.every(trigger => {
		switch (trigger.type) {
			case 'counter':
				return (counters[trigger.key] ?? 0) >= trigger.threshold;
			case 'time':
			case 'event':
			default:
				return false;
		}
	});
}

export function checkAdvancement(progress: QuestlineProgress, questline: Questline): boolean {
	if (progress.currentStageIndex >= questline.stages.length - 1) return false;
	const currentStage = questline.stages[progress.currentStageIndex];
	return triggersAreMet(currentStage.advancementTriggers, progress.counters);
}

export function checkRegression(progress: QuestlineProgress, questline: Questline): boolean {
	if (progress.currentStageIndex <= 0) return false;
	const currentStage = questline.stages[progress.currentStageIndex];
	return triggersAreMet(currentStage.regressionTriggers, progress.counters);
}

export function updateQuestlines(
	progressList: QuestlineProgress[],
	questlines: Questline[]
): QuestlineProgress[] {
	return progressList.map(progress => {
		const questline = questlines.find(q => q.id === progress.questlineId);
		if (!questline) return { ...progress };
		const updated = { ...progress, counters: { ...progress.counters } };
		if (checkAdvancement(progress, questline)) {
			updated.currentStageIndex = progress.currentStageIndex + 1;
		} else if (checkRegression(progress, questline)) {
			updated.currentStageIndex = progress.currentStageIndex - 1;
		}
		return updated;
	});
}
