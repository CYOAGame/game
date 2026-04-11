export class AuthExpiredError extends Error {
	constructor(message: string = 'GitHub session expired') {
		super(message);
		this.name = 'AuthExpiredError';
	}
}
