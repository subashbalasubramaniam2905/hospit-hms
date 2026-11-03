import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withHashLocation, withInMemoryScrolling } from '@angular/router';
import { LocationStrategy } from '@angular/common';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { LucideAngularModule } from 'lucide-angular';
import { routes } from './app.routes';
import { APP_ICONS } from './core/icons';
import { MemoryLocationStrategy } from './core/services/memory-location';

/** Inside an embedded preview frame the address bar cannot change, so routes are kept in memory there. */
const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding(), withHashLocation(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    ...(embedded ? [{ provide: LocationStrategy, useClass: MemoryLocationStrategy }] : []),
    provideAnimationsAsync(),
    importProvidersFrom(LucideAngularModule.pick(APP_ICONS)),
  ]
};
