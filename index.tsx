

import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection, isDevMode, enableProdMode } from '@angular/core';

if (!isDevMode()) {
  enableProdMode();
}

import { provideRouter, withHashLocation } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { AppComponent } from './src/app.component';
import { routes } from './src/app.routes';
import { metaReducers } from './src/app/state/meta-reducers';
import { reducers } from './src/app/state/reducers';
import { GreetingEffects } from './src/app/state/greeting.effects';

bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withHashLocation()),
    
    // NgRx Store Initialization com Checks de Imutabilidade Estritos
    provideStore(reducers, { 
      metaReducers,
      runtimeChecks: {
        strictStateImmutability: true,
        strictActionImmutability: true,
        strictStateSerializability: true,
        strictActionSerializability: true,
        strictActionTypeUniqueness: true
      }
    }),
    
    // NgRx Effects Initialization
    provideEffects([GreetingEffects]),
    
    // NgRx DevTools (Habilitado apenas em desenvolvimento)
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode(),
      autoPause: true,
      trace: false,
      traceLimit: 75,
      connectInZone: true
    }),
    
    provideServiceWorker('ngsw-worker.js', {
        enabled: true,
        registrationStrategy: 'registerWhenStable:30000'
    })
  ]
}).catch(err => console.error(err));

// AI Studio always uses an `index.tsx` file for all project types.
