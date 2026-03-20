import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class InstallManagerService {
  private deferredPrompt: Record<string, unknown> | null = null;
  public isInstallable = signal<boolean>(false);
  public isStandalone = signal<boolean>(false);

  constructor() {
    this.checkStandalone();
    
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.deferredPrompt = e as any;
      this.isInstallable.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.isInstallable.set(false);
      this.isStandalone.set(true);
    });
    
    window.matchMedia('(display-mode: standalone)').addEventListener('change', (evt) => {
      this.isStandalone.set(evt.matches);
    });
  }

  private checkStandalone() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches 
      || (window.navigator as unknown as Record<string, unknown>)['standalone'] 
      || document.referrer.includes('android-app://');
    this.isStandalone.set(!!isStandalone);
  }

  public async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) return false;
    
    (this.deferredPrompt['prompt'] as () => void)();
    const userChoice = (this.deferredPrompt['userChoice'] as Promise<{ outcome: string }>);
    const { outcome } = await userChoice;
    
    this.deferredPrompt = null;
    this.isInstallable.set(false);
    
    return outcome === 'accepted';
  }
}
