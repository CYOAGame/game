import { describe, it, expect } from 'vitest';
import { AuthExpiredError } from '../../src/lib/git/auth-errors';

describe('AuthExpiredError', () => {
	it('is an instance of Error', () => {
		const err = new AuthExpiredError();
		expect(err).toBeInstanceOf(Error);
	});

	it('has name "AuthExpiredError"', () => {
		const err = new AuthExpiredError();
		expect(err.name).toBe('AuthExpiredError');
	});

	it('has a default message', () => {
		const err = new AuthExpiredError();
		expect(err.message).toBe('GitHub session expired');
	});

	it('accepts a custom message', () => {
		const err = new AuthExpiredError('Token revoked');
		expect(err.message).toBe('Token revoked');
	});

	it('can be caught as a specific type', () => {
		try {
			throw new AuthExpiredError();
		} catch (err) {
			expect(err instanceof AuthExpiredError).toBe(true);
		}
	});
});
