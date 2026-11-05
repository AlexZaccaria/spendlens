import { Component, inject, signal } from '@angular/core';
import { email, form, FormField, required, submit } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { apiErrorCode, apiErrorMessage } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { Icon } from '../../ui/icon';
import { AuthLayout } from './auth-layout';
import { DemoCta } from './demo-cta';

@Component({
  selector: 'app-login-page',
  imports: [AuthLayout, DemoCta, FormField, Icon, RouterLink],
  templateUrl: './login-page.html',
})
export class LoginPage {
  private readonly auth = inject(Auth);
  protected readonly t = inject(I18n).t;
  /** The static demo has no accounts: the form stays visible, disabled. */
  protected readonly signInOpen = this.auth.signInOpen;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly model = signal({ email: '', password: '' });
  protected readonly login = form(this.model, (p) => {
    required(p.email, { message: this.t().auth.required });
    email(p.email, { message: this.t().auth.invalidEmail });
    required(p.password, { message: this.t().auth.required });
  });

  protected async signIn(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.login, async () => {
      this.busy.set(true);
      this.error.set(null);
      try {
        await this.auth.signIn({ email: this.model().email.trim(), password: this.model().password });
      } catch (err) {
        const code = apiErrorCode(err);
        this.error.set(
          code === 'wrong_credentials' ? this.t().auth.wrongCredentials : code === 'too_many_attempts' ? this.t().auth.tooManyAttempts : apiErrorMessage(err),
        );
        this.busy.set(false);
      }
    });
  }
}
