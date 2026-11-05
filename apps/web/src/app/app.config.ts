import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { provideEchartsCore } from 'ngx-echarts';
import { routes } from './app.routes';
import { sessionEndedInterceptor } from './core/auth';

// Zoneless and OnPush are the Angular 22 defaults: change detection is driven by signals alone.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withInterceptors([sessionEndedInterceptor])),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions({ skipInitialTransition: true }),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideEchartsCore({ echarts: () => import('./core/echarts').then((m) => m.default) }),
  ],
};
