import type { Character, GameDate } from '../types/state';
import type { ChoiceRecord } from '../types/session';

function formatDate(date: GameDate): string {
	const season = date.season.charAt(0).toUpperCase() + date.season.slice(1);
	return `${season}, Day ${date.day}, Year ${date.year}`;
}

function archetypeLabel(archetypeId: string): string {
	return archetypeId
		.split(/[-_]/)
		.map(w => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

export function formatJournalEntry(
	character: Character,
	date: GameDate,
	choiceLog: ChoiceRecord[],
	isDead: boolean = false,
	narrativeLog?: Array<{ text: string; choiceLabel?: string }>
): string {
	const lines: string[] = [];

	lines.push(`# ${character.name} the ${archetypeLabel(character.archetypeId)}`);
	lines.push('');
	lines.push(`**${formatDate(date)}**`);
	lines.push('');

	if (isDead) {
		lines.push(`*${character.name} did not survive this day.*`);
		lines.push('');
	}

	if (narrativeLog && narrativeLog.length > 0) {
		for (const entry of narrativeLog) {
			if (entry.choiceLabel) {
				lines.push(`> ${entry.text}`);
				lines.push('');
			} else {
				lines.push(entry.text);
				lines.push('');
			}
		}
	} else if (choiceLog.length > 0) {
		for (const entry of choiceLog) {
			if (entry.narrativeText) {
				lines.push(entry.narrativeText);
				lines.push('');
			}
			lines.push(`> ${entry.text}`);
			lines.push('');
		}
	} else if (!isDead) {
		lines.push('*A quiet day passed without incident.*');
		lines.push('');
	}

	return lines.join('\n');
}

export function journalFilePath(character: Pick<Character, 'id'>, date: GameDate): string {
	const year = String(date.year).padStart(4, '0');
	const season = date.season.toLowerCase();
	const day = date.day;
	return `journals/${character.id}/${year}-${season}-${day}.md`;
}
