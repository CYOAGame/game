import { parseRepoUrl } from '$lib/git/github-client';

export type WizardStep =
	| 'choose'
	| 'create-step1'
	| 'create-step2'
	| 'join-step1'
	| 'join-step2'
	| 'done';

export type WizardVariant = 'create' | 'join' | null;

export interface WizardState {
	step: WizardStep;
	variant: WizardVariant;
	repoOwner: string;
	repoName: string;
	token: string;
	error: string | null;
}

export type WizardAction =
	| { type: 'pick-create' }
	| { type: 'pick-join' }
	| { type: 'submit-repo'; value: string }
	| { type: 'submit-token'; value: string }
	| { type: 'back' }
	| { type: 'reset' };

const STORAGE_KEY = 'journal-rpg-pat-wizard';

export function initialWizardState(): WizardState {
	return {
		step: 'choose',
		variant: null,
		repoOwner: '',
		repoName: '',
		token: '',
		error: null
	};
}

export function transition(state: WizardState, action: WizardAction): WizardState {
	const clearErr = { ...state, error: null };
	switch (action.type) {
		case 'pick-create':
			return { ...clearErr, step: 'create-step1', variant: 'create' };
		case 'pick-join':
			return { ...clearErr, step: 'join-step1', variant: 'join' };
		case 'submit-repo': {
			const parsed = parseRepoUrl(action.value);
			if (!parsed) {
				return {
					...state,
					error: 'Could not parse owner/repo. Try "owner/repo" or a full GitHub URL.'
				};
			}
			const nextStep: WizardStep =
				state.variant === 'create' ? 'create-step2' : 'join-step2';
			return {
				...clearErr,
				step: nextStep,
				repoOwner: parsed.owner,
				repoName: parsed.repo
			};
		}
		case 'submit-token': {
			const trimmed = action.value.trim();
			if (!trimmed) {
				return { ...state, error: 'Please paste a token.' };
			}
			return { ...clearErr, step: 'done', token: trimmed };
		}
		case 'back':
			if (state.step === 'create-step2') return { ...clearErr, step: 'create-step1' };
			if (state.step === 'join-step2') return { ...clearErr, step: 'join-step1' };
			if (state.step === 'create-step1' || state.step === 'join-step1') {
				return initialWizardState();
			}
			return state;
		case 'reset':
			return initialWizardState();
	}
}

export function saveWizardState(state: WizardState): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadWizardState(): WizardState | null {
	if (typeof sessionStorage === 'undefined') return null;
	const raw = sessionStorage.getItem(STORAGE_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as WizardState;
	} catch {
		return null;
	}
}

export function clearWizardState(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.removeItem(STORAGE_KEY);
}
