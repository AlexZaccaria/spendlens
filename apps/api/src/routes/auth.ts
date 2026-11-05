import type { Session } from '@spendlens/contracts';
import { loginSchema } from '@spendlens/contracts/schemas';
import { Hono, type Context } from 'hono';
import { verifyAgainstDecoy, verifyPassword } from '../accounts/passwords.ts';
import { createSession, deleteSession, findLogin, SESSION_TTL_MS, sessionAccount } from '../accounts/store.ts';
import type { Tenancy } from '../accounts/tenancy.ts';
import { clearSessionCookie, clientIp, RateLimit, sessionToken, sessionView, setSessionCookie } from '../http/auth.ts';
import { HttpError, validate } from '../http/validate.ts';

/** Accounts are created from the command line (`npm run account`); the sign-up page is closed. */
const REGISTRATION_OPEN = false;

export function authRoutes(tenancy: Tenancy) {
  // Per address and email: a password cannot be guessed at speed, one visitor cannot lock out another.
  const logins = new RateLimit(10, 15 * 60_000);
  // Per address alone: bounds guessing across many emails (and the argon2 work each attempt costs).
  const loginsByIp = new RateLimit(50, 15 * 60_000);
  const demos = new RateLimit(20, 60 * 60_000);

  /** Ends the browser's current session; leaving a demo deletes its copy at once. */
  const endSession = (c: Context): void => {
    const token = sessionToken(c);
    if (!token) return;
    const session = sessionAccount(tenancy.system, token);
    if (session?.account.kind === 'sandbox') tenancy.removeAccount(session.account.id);
    else deleteSession(tenancy.system, token);
  };

  return new Hono()
    .get('/session', (c) => {
      const token = sessionToken(c);
      const session = token ? sessionAccount(tenancy.system, token) : null;
      if (token && session?.renewedUntil) setSessionCookie(c, token, session.renewedUntil);
      return c.json({ account: session ? sessionView(session.account) : null, registrationOpen: REGISTRATION_OPEN, signInOpen: true } satisfies Session);
    })

    .post('/login', validate('json', loginSchema), async (c) => {
      const { email, password } = c.req.valid('json');
      const ip = clientIp(c);
      if (!loginsByIp.take(ip) || !logins.take(`${ip}|${email.toLowerCase()}`)) {
        throw new HttpError(429, 'too_many_attempts', 'Too many attempts: wait a few minutes.');
      }
      const login = findLogin(tenancy.system, email);
      // Same work and the same answer whether the email is unknown, has no password or the password is wrong.
      const ok = login?.passwordHash ? await verifyPassword(password, login.passwordHash) : await verifyAgainstDecoy(password);
      if (!login || !ok) throw new HttpError(401, 'wrong_credentials', 'Wrong email or password.');
      endSession(c);
      const expires = new Date(Date.now() + SESSION_TTL_MS);
      setSessionCookie(c, createSession(tenancy.system, login.account.id, expires), expires);
      return c.json(sessionView(login.account));
    })

    .post('/demo', (c) => {
      if (!demos.take(clientIp(c))) throw new HttpError(429, 'too_many_attempts', 'Too many demos from this address: try again later.');
      endSession(c);
      const account = tenancy.createSandbox();
      const expires = new Date(account.expiresAt!);
      setSessionCookie(c, createSession(tenancy.system, account.id, expires), expires);
      return c.json(sessionView(account));
    })

    .post('/logout', (c) => {
      endSession(c);
      clearSessionCookie(c);
      return c.json({ ok: true });
    })

    .post('/register', () => {
      throw new HttpError(403, 'registration_closed', 'Registration is closed.');
    });
}
