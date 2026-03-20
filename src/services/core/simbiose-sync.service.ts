
/* =========================================================
   SIMBIOSE — SINCRONIZAÇÃO (DESATIVADO)
   ========================================================= */

import { Injectable, signal, inject } from '@angular/core';
import { SimbioseOfflineQueue } from './simbiose-offline-queue.service';
import { SimbiosePolicyEngine, FuncaoUsuario } from './simbiose-policy.service';

@Injectable({ providedIn: 'root' })
export class SimbioseSyncService {

  online = signal<boolean>(navigator.onLine);
  sincronizando = signal<boolean>(false);

  private queue = inject(SimbioseOfflineQueue);
  private policy = inject(SimbiosePolicyEngine);

  constructor() {
    // A sincronização centralizada foi substituída pela rede P2P Quantum Net.
    // A lógica de sincronização de dados de clientes foi removida.
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }

  /**
   * Este método foi desativado e não executa mais a sincronização de dados de clientes.
   * A sincronização de INTELIGÊNCIA agora é feita pelo QuantumNetService.
   */
  async sincronizar(_funcaoUsuario: FuncaoUsuario) {
    void _funcaoUsuario;
    if (this.sincronizando()) return;

    console.log('[Quantum Sync] Modo de Sincronização Central Desativado. Usando rede P2P Darkseid.');
    
    // Limpa a fila de itens antigos para evitar processamento desnecessário.
    const itens = this.queue.pendentes();
    if (itens.length > 0) {
        console.log(`[Quantum Sync] Limpando ${itens.length} item(s) da fila de sincronização legada.`);
        this.queue.limparConcluidos();
    }

    return Promise.resolve();
  }
}
