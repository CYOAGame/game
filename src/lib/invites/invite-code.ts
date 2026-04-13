export interface InvitePayload {
	owner: string;
	repo: string;
	token: string;
}

export function encodeInviteCode(owner: string, repo: string, token: string): string {
	const json = JSON.stringify({ owner, repo, token });
	const base64 = btoa(json);
	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeInviteCode(code: string): InvitePayload | null {
	try {
		if (!code) return null;
		let base64 = code.replace(/-/g, '+').replace(/_/g, '/');
		while (base64.length % 4) base64 += '=';
		const json = atob(base64);
		const parsed = JSON.parse(json);
		if (typeof parsed.repo !== 'string' || typeof parsed.token !== 'string') return null;
		if (!parsed.repo || !parsed.token) return null;
		// Support old codes that lack owner — fall back to empty string
		return { owner: parsed.owner ?? '', repo: parsed.repo, token: parsed.token };
	} catch {
		return null;
	}
}
