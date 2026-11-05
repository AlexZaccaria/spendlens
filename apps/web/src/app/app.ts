import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastHost } from './ui/toast-host';

/** The root: the login pages or the signed-in shell, as the router decides, and the toasts. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost],
  template: `
    <router-outlet />
    <app-toast-host />
  `,
})
export class App {}
