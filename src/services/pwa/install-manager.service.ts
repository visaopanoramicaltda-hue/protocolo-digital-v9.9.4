import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class InstallManagerService {
  private deferredPrompt: any;
  public isInstallable = signal<boolean>(false);
  public isStandalone = signal<boolean>(false);

  constructor() {
    this.checkStandalone();
    
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
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
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches 
      || (window.navigator as any).standalone 
      || document.referrer.includes('android-app://');
    this.isStandalone.set(isStandalone);
  }

  public async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) return false;
    
    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    
    this.deferredPrompt = null;
    this.isInstallable.set(false);
    
    return outcome === 'accepted';
  }
}
