import { Injectable, inject } from '@angular/core';
import { Router, NavigationStart, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class PerformanceTelemetryService {
  private navStartTime = 0;
  private router = inject(Router);

  constructor() {
    this.initWebVitals();
    this.trackNavigation();
  }

  private initWebVitals() {
    if (typeof window !== 'undefined' && 'PerformanceObserver' in window) {
      try {
        new PerformanceObserver(() => {
          // LCP
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {}

      try {
        new PerformanceObserver(() => {
          // FID / INP
        }).observe({ type: 'first-input', buffered: true });
      } catch {}

      try {
        new PerformanceObserver(() => {
          // CLS
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {}
    }
  }

  private trackNavigation() {
    this.router.events.pipe(
      filter(e => e instanceof NavigationStart || e instanceof NavigationEnd)
    ).subscribe(event => {
      if (event instanceof NavigationStart) {
        this.navStartTime = performance.now();
      } else if (event instanceof NavigationEnd) {
        const duration = performance.now() - this.navStartTime;
        if (duration > 500) {
          console.warn(`[Telemetry] Slow route detected: ${event.urlAfterRedirects} (${duration.toFixed(2)}ms)`);
        }
      }
    });
  }
}
