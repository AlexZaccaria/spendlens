import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n } from '../../core/i18n/i18n';
import { Icon } from '../../ui/icon';
import { AuthLayout } from './auth-layout';
import { DemoCta } from './demo-cta';

/** The sign-up form, shown closed: accounts are created from the command line. */
@Component({
  selector: 'app-register-page',
  imports: [AuthLayout, DemoCta, Icon, RouterLink],
  templateUrl: './register-page.html',
})
export class RegisterPage {
  protected readonly t = inject(I18n).t;
}
