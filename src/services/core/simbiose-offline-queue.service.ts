/* =========================================================
   SIMBIOSE — FILA OFFLINE
   ========================================================= */

import { Injectable } from '@angular/core';

export type FilaItem = {
  id: string;
  tipo: 'PROTOCOLO' | 'NOTIFICACAO';
  payload: any;
  status: 'PENDENTE' | 'SINCRONIZADO' | 'BLOQUEADO';
  criadoEm: string;
};

@Injectable({ providedIn: 'root' })
export class SimbioseOfflineQueue {

  private KEY = 'SIMBIOSE_OFFLINE_QUEUE';

  private load(): FilaItem[] {
    try {
      const data = localStorage.getItem(this.KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private save(queue: FilaItem[]) {
    localStorage.setItem(this.KEY, JSON.stringify(queue));
  }

  adicionar(item: Omit<FilaItem, 'status' | 'criadoEm'>) {
    const fila = this.load();
    fila.push({
      ...item,
      status: 'PENDENTE',
      criadoEm: new Date().toISOString()
    });
    this.save(fila);
  }

  listar() {
    return this.load();
  }

  marcarComo(id: string, status: FilaItem['status']) {
    const fila = this.load().map(i =>
      i.id === id ? { ...i, status } : i
    );
    this.save(fila);
  }

  pendentes() {
    return this.load().filter(i => i.status === 'PENDENTE');
  }
  
  limparConcluidos() {
    const fila = this.load().filter(i => i.status === 'PENDENTE');
    this.save(fila);
  }
}
