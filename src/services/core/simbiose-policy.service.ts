/* =========================================================
   SIMBIOSE — POLICY ENGINE
   ========================================================= */

import { Injectable, signal } from '@angular/core';

export type FuncaoUsuario = 'PORTEIRO' | 'OPERADOR' | 'ADMIN';

export type AcaoSistema =
  | 'CRIAR_PROTOCOLO'
  | 'NOTIFICAR'
  | 'SINCRONIZAR'
  | 'VER_ADMIN';

@Injectable({ providedIn: 'root' })
export class SimbiosePolicyEngine {

  // Policy dinâmica (editável no painel admin)
  policies = signal<Record<FuncaoUsuario, AcaoSistema[]>>({
    PORTEIRO: ['CRIAR_PROTOCOLO', 'NOTIFICAR'],
    OPERADOR: ['CRIAR_PROTOCOLO', 'NOTIFICAR', 'SINCRONIZAR'],
    ADMIN: ['CRIAR_PROTOCOLO', 'NOTIFICAR', 'SINCRONIZAR', 'VER_ADMIN']
  });

  podeExecutar(funcao: FuncaoUsuario, acao: AcaoSistema): boolean {
    return this.policies()[funcao]?.includes(acao) ?? false;
  }

  // Admin pode alterar regras em tempo real
  atualizarPolicy(funcao: FuncaoUsuario, acoes: AcaoSistema[]) {
    const atual = this.policies();
    atual[funcao] = acoes;
    this.policies.set({ ...atual });
  }
}
