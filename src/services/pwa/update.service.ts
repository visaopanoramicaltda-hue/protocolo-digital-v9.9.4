import { Injectable, ApplicationRef, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, first } from 'rxjs/operators';
import { concat, interval } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UpdateService {
  private swUpdate = inject(SwUpdate);
  private appRef = inject(ApplicationRef);

  constructor() {
    if (!this.swUpdate.isEnabled) return;

    const appIsStable$ = this.appRef.isStable.pipe(first(isStable => isStable === true));
    const everySixHours$ = interval(6 * 60 * 60 * 1000);
    const everySixHoursOnceAppIsStable$ = concat(appIsStable$, everySixHours$);

    everySixHoursOnceAppIsStable$.subscribe(async () => {
      try {
        await this.swUpdate.checkForUpdate();
      } catch (err) {
        console.error('[PWA] Update check failed', err);
      }
    });

    this.swUpdate.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe(() => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            this.swUpdate.activateUpdate().then(() => document.location.reload());
          }
        }, { once: true });
      });
  }
}
