
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SimbioseKillSwitchService {

  bloqueado = signal(false);

  constructor() {}

  get isConnected(): boolean {
    return false;
  }

  async verificar() {
    // MODO OFFLINE SEGURO: Sempre permite execução.
    this.bloqueado.set(false);
    return Promise.resolve();
  }
}
