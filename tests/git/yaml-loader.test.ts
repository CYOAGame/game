import { describe, it, expect } from 'vitest';
import { parseYamlContent, buildWorldBlocksFromFiles } from '../../src/lib/git/yaml-loader';

describe('parseYamlContent', () => {
	it('parses base64-encoded YAML content', () => {
		const base64 = btoa('name: Test\nvalue: 42');
		const result = parseYamlContent(base64);
		expect(result).toEqual({ name: 'Test', value: 42 });
	});
	it('returns null for invalid content', () => {
		expect(parseYamlContent('')).toBeNull();
	});
});

describe('buildWorldBlocksFromFiles', () => {
	it('builds WorldBlocks from a file map', () => {
		const files = new Map<string, string>();
		files.set('world.yaml', btoa('name: Test World\ndescription: A test\nsetting: medieval\ndateSystem:\n  seasons: [spring, summer]\n  daysPerSeason: 30\n  startYear: 845\nstartingFactions: []\nactiveQuestlines: []\ntheme: {}'));
		files.set('blocks/archetypes/soldier.yaml', btoa('id: soldier\nname: Soldier\ntraits:\n  strength: { min: 5, max: 9 }\nskills: [swordsmanship]\nnamingPatterns: [Aldric]\nactivities: [standing watch]'));
		const blocks = buildWorldBlocksFromFiles(files);
		expect(blocks.config.name).toBe('Test World');
		expect(blocks.archetypes).toHaveLength(1);
		expect(blocks.archetypes[0].id).toBe('soldier');
	});
});
