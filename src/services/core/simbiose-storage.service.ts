
import { Injectable } from '@angular/core';

export type TabelaSimbiose = 'protocolos' | 'pessoas' | 'transportadoras';

@Injectable({ providedIn: 'root' })
export class SimbioseStorageService {
  // --- LOCAL STORAGE CONFIG (SIMBIOSE_DB_V2) ---
  private readonly DB_PREFIX = 'SIMBIOSE_DB_V2::';

  constructor() {
    // Operação puramente local
  }

  get isConnected(): boolean {
    return false;
  }

  /* ===================== PERSISTÊNCIA LOCAL (OFFLINE-FIRST) ===================== */
  private getKey(tabela: TabelaSimbiose): string { return `${this.DB_PREFIX}${tabela}`; }
  
  salvar<T = any>(tabela: TabelaSimbiose, dados: T & { id?: string }): T & { id: string } {
    const lista = this.listar(tabela);
    if (!dados.id) dados.id = crypto.randomUUID();
    const index = lista.findIndex((item: any) => item.id === dados.id);
    if (index >= 0) lista[index] = { ...lista[index], ...dados };
    else lista.push(dados);
    try { localStorage.setItem(this.getKey(tabela), JSON.stringify(lista)); } catch (e) { console.error('SimbioseStorage: Erro de Quota localStorage', e); }
    return dados as T & { id: string };
  }
  
  listar<T = any>(tabela: TabelaSimbiose): T[] {
    const raw = localStorage.getItem(this.getKey(tabela));
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }
  
  buscarPorId<T = any>(tabela: TabelaSimbiose, id: string): T | undefined {
    return this.listar<T>(tabela).find((item: any) => item.id === id);
  }
  
  remover(tabela: TabelaSimbiose, id: string): void {
    const lista = this.listar(tabela).filter((item: any) => item.id !== id);
    localStorage.setItem(this.getKey(tabela), JSON.stringify(lista));
  }
  
  limparTabela(tabela: TabelaSimbiose): void { localStorage.removeItem(this.getKey(tabela)); }

  /* ===================== ARMAZENAMENTO SIMULADO ===================== */

  async uploadPdf(id: string, pdf: Blob): Promise<string> {
    // Gera URL local imediata. Zero latência.
    return Promise.resolve(URL.createObjectURL(pdf));
  }
  
  async resgatarEDestruir(id: string): Promise<Blob> {
    throw new Error('Função de nuvem desativada.');
  }
}
