import { describe, it, expect, beforeEach } from 'vitest';
import {
	initialWizardState,
	transition,
	saveWizardState,
	loadWizardState,
	clearWizardState,
	type WizardState
} from '../../src/routes/login/pat-wizard/wizard-state';

class MemoryStorage {
	private store = new Map<string, string>();
	getItem(k: string) { return this.store.get(k) ?? null; }
	setItem(k: string, v: string) { this.store.set(k, v); }
	removeItem(k: string) { this.store.delete(k); }
	clear() { this.store.clear(); }
	get length() { return this.store.size; }
	key(i: number) { return [...this.store.keys()][i] ?? null; }
}

beforeEach(() => {
	(globalThis as any).sessionStorage = new MemoryStorage();
});

describe('wizard state machine', () => {
	it('starts at the "choose" step', () => {
		const s = initialWizardState();
		expect(s.step).toBe('choose');
		expect(s.variant).toBeNull();
		expect(s.repoOwner).toBe('');
		expect(s.repoName).toBe('');
		expect(s.token).toBe('');
	});

	it('choose → create-step1 on pick-create', () => {
		const s = transition(initialWizardState(), { type: 'pick-create' });
		expect(s.step).toBe('create-step1');
		expect(s.variant).toBe('create');
	});

	it('choose → join-step1 on pick-join', () => {
		const s = transition(initialWizardState(), { type: 'pick-join' });
		expect(s.step).toBe('join-step1');
		expect(s.variant).toBe('join');
	});

	it('create-step1 advances to create-step2 with a valid repo', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'submit-repo', value: 'alice/ironhaven-fork' });
		expect(s.step).toBe('create-step2');
		expect(s.repoOwner).toBe('alice');
		expect(s.repoName).toBe('ironhaven-fork');
	});

	it('create-step1 rejects an unparseable repo and stays on step', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'submit-repo', value: 'not-a-repo' });
		expect(s.step).toBe('create-step1');
		expect(s.error).toContain('owner/repo');
	});

	it('join-step1 advances to join-step2 with a valid repo', () => {
		let s = transition(initialWizardState(), { type: 'pick-join' });
		s = transition(s, { type: 'submit-repo', value: 'CYOAGame/Public_Game' });
		expect(s.step).toBe('join-step2');
		expect(s.repoOwner).toBe('CYOAGame');
		expect(s.repoName).toBe('Public_Game');
	});

	it('step2 advances to "done" on submit-token', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'submit-repo', value: 'alice/fork' });
		s = transition(s, { type: 'submit-token', value: 'github_pat_AAA' });
		expect(s.step).toBe('done');
		expect(s.token).toBe('github_pat_AAA');
	});

	it('step2 rejects an empty token and stays on step', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'submit-repo', value: 'alice/fork' });
		s = transition(s, { type: 'submit-token', value: '   ' });
		expect(s.step).toBe('create-step2');
		expect(s.error).toContain('token');
	});

	it('back from create-step2 returns to create-step1 and preserves repo', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'submit-repo', value: 'alice/fork' });
		s = transition(s, { type: 'back' });
		expect(s.step).toBe('create-step1');
		expect(s.repoOwner).toBe('alice');
		expect(s.repoName).toBe('fork');
	});

	it('back from create-step1 returns to choose and clears variant', () => {
		let s = transition(initialWizardState(), { type: 'pick-create' });
		s = transition(s, { type: 'back' });
		expect(s.step).toBe('choose');
		expect(s.variant).toBeNull();
	});
});

describe('wizard state persistence', () => {
	it('saves and loads the full state', () => {
		const state: WizardState = {
			step: 'create-step2',
			variant: 'create',
			repoOwner: 'alice',
			repoName: 'fork',
			token: '',
			error: null
		};
		saveWizardState(state);
		const loaded = loadWizardState();
		expect(loaded).toEqual(state);
	});

	it('loadWizardState returns null when nothing is saved', () => {
		expect(loadWizardState()).toBeNull();
	});

	it('clearWizardState removes saved state', () => {
		saveWizardState({
			step: 'create-step1',
			variant: 'create',
			repoOwner: '',
			repoName: '',
			token: '',
			error: null
		});
		clearWizardState();
		expect(loadWizardState()).toBeNull();
	});
});
