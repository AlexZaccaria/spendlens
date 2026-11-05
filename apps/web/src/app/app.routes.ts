import type { Routes } from '@angular/router';
import { authGuard, demoGuard, guestGuard } from './core/auth';

export const routes: Routes = [
  { path: 'login', canMatch: [guestGuard], loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage), title: 'Spendlens · Login' },
  { path: 'register', canMatch: [guestGuard], loadComponent: () => import('./features/auth/register-page').then((m) => m.RegisterPage), title: 'Spendlens · Sign up' },
  {
    path: '',
    canMatch: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard), title: 'Spendlens' },
      { path: 'transactions', loadComponent: () => import('./features/transactions/transactions').then((m) => m.Transactions), title: 'Spendlens · Movimenti' },
      { path: 'import', loadComponent: () => import('./features/import/import-page').then((m) => m.ImportPage), title: 'Spendlens · Import' },
      { path: 'settings', loadComponent: () => import('./features/settings/settings').then((m) => m.Settings), title: 'Spendlens · Settings' },
      { path: 'about', canMatch: [demoGuard], loadComponent: () => import('./features/about/about-page').then((m) => m.AboutPage), title: 'Spendlens · About this' },
    ],
  },
  // Signed out, an unknown path (and any app path, via the guard above) ends on the login.
  { path: '**', redirectTo: 'login' },
];
