
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SimbioseAuditService {

  constructor() {}

  get isConnected(): boolean {
    return false;
  }

  async registrarEvento(dados: {
    protocoloId: string;
    tipo: 'ENCOMENDA' | 'CORRESPONDENCIA';
    evento: 'ENTRADA' | 'SAIDA';
    hash: string;
  }) {
    // Log local leve para console (pode ser expandido para IndexedDB se necessário futuramente)
    // Evita overhead de rede.
    console.log('[AUDIT] Evento:', dados);
    return Promise.resolve();
  }
}
