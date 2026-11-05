import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { startBackend } from './app/core/backend';

startBackend()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => {
    console.error(err);
    document.querySelector('[data-boot]')?.setAttribute('data-boot', 'failed');
  });
