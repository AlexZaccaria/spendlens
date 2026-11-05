import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { computed, inject, Service, signal } from '@angular/core';
import { Router, type CanMatchFn } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import type { Login, Session, SessionAccount } from '@spendlens/contracts';
import { API } from './api';

/**
 * The signed-in account. The session itself is an HttpOnly cookie the app never reads: the API
 * says who is signed in. Signing in or out reloads the page, so nothing of the previous account
 * (cached lists, charts, form state) survives in memory.
 */
@Service()
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly location = inject(DOCUMENT).location;
  private session: Promise<SessionAccount | null> | null = null;

  readonly account = signal<SessionAccount | null>(null);
  readonly isDemo = computed(() => this.account()?.demo ?? false);
  /** False in the static demo, which has no accounts to sign in to. */
  readonly signInOpen = signal(true);

  /** Asks the API once per page load. */
  load(): Promise<SessionAccount | null> {
    this.session ??= firstValueFrom(this.http.get<Session>(`${API}/auth/session`))
      .then((s) => {
        this.signInOpen.set(s.signInOpen);
        return s.account;
      })
      .catch(() => null)
      .then((account) => {
        this.account.set(account);
        return account;
      });
    return this.session;
  }

  async signIn(login: Login): Promise<void> {
    await firstValueFrom(this.http.post(`${API}/auth/login`, login));
    this.location.assign('/');
  }

  async startDemo(): Promise<void> {
    await firstValueFrom(this.http.post(`${API}/auth/demo`, {}));
    this.location.assign('/');
  }

  async signOut(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${API}/auth/logout`, {}));
    } finally {
      this.location.assign('/login');
    }
  }
}

/** The app itself: only for a signed-in account. */
export const authGuard: CanMatchFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  return (await auth.load()) ? true : router.parseUrl('/login');
};

/** Login and sign-up: only when nobody is signed in. */
export const guestGuard: CanMatchFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  return (await auth.load()) ? router.parseUrl('/') : true;
};

/** Pages for demo visitors only (the project page). The parent route has already loaded the account. */
export const demoGuard: CanMatchFn = () => inject(Auth).isDemo();

/** A session that ended under the app (a demo that expired, a password changed elsewhere) goes back to the login. */
export const sessionEndedInterceptor: HttpInterceptorFn = (req, next) => {
  const location = inject(DOCUMENT).location;
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !req.url.includes('/auth/')) location.assign('/login');
      return throwError(() => err);
    }),
  );
};
