
import { Injectable } from '@angular/core';

// ATENÇÃO: Serviço transformado em STUB OFFLINE.
// A biblioteca @supabase/supabase-js foi removida para performance.

@Injectable({ providedIn: 'root' })
export class SupabaseService {

  constructor() {
    // Modo 100% offline. Nenhum cliente externo é inicializado.
  }

  get isConnected(): boolean {
    return false; 
  }

  async testeConexao() {
    return Promise.resolve();
  }

  listarPessoas() {
    return Promise.resolve({ data: [], error: null });
  }

  criarPessoa(pessoa: {
    nome: string;
    tipo: 'MORADOR' | 'OPERARIO' | 'MOTOQUEIRO';
    telefone?: string;
  }) {
    // Retorna sucesso com ID local (mock)
    return Promise.resolve({ data: [{ ...pessoa, id: crypto.randomUUID() }], error: null });
  }

  criarProtocolo(protocolo: any) {
    const id = protocolo.id || crypto.randomUUID();
    return Promise.resolve({ data: [{ ...protocolo, id }], error: null });
  }

  listarProtocolos() {
    return Promise.resolve({ data: [], error: null });
  }
}
