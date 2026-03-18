/* =========================================================
   SIMBIOSE — ORQUESTRADOR LLaMA + GEMINI
   Angular 20+ | Motor Duplo | Bloco Único
   ========================================================= */

import { Injectable } from '@angular/core';

/* ===================== TIPOS ===================== */
type DecisaoLLaMA = {
  tipoPessoa: 'MORADOR' | 'OPERARIO' | 'MOTOQUEIRO';
  fluxo: 'ENTRADA' | 'SAIDA';
  risco: 'BAIXO' | 'MEDIO' | 'ALTO';
};

@Injectable({ providedIn: 'root' })
export class SimbioseOrquestradorService {

  /* ===================== LLaMA =====================
     Motor lógico, seco, sem criatividade
  =================================================== */
  async executarLLaMA(dados: any): Promise<DecisaoLLaMA> {

    // Regras duras (determinísticas)
    if (dados.transportadora && dados.transportadora !== 'Não identificado') {
      return {
        tipoPessoa: 'MORADOR',
        fluxo: 'ENTRADA',
        risco: 'BAIXO'
      };
    }

    if (dados.tipoEntrega === 'RETIRADA') {
      return {
        tipoPessoa: 'MOTOQUEIRO',
        fluxo: 'SAIDA',
        risco: 'MEDIO'
      };
    }

    return {
      tipoPessoa: 'OPERARIO',
      fluxo: 'ENTRADA',
      risco: 'ALTO'
    };
  }

  /* ===================== GEMINI =====================
     Motor semântico / linguagem humana
  =================================================== */
  async executarGemini(
    pessoa: { nome: string; tipo: string },
    protocolo: any
  ): Promise<string> {

    if (pessoa.tipo === 'MORADOR') {
      return `
Olá ${pessoa.nome},

Uma nova encomenda chegou para você.

Bloco: ${protocolo.bloco}
Unidade: ${protocolo.unidade}
Condição: ${protocolo.condicao}

Assim que estiver disponível para retirada, avisaremos.
`;
    }

    if (pessoa.tipo === 'MOTOQUEIRO') {
      return `
Retirada autorizada.

Código do protocolo: ${protocolo.id}
Apresente este código na portaria.
`;
    }

    return `
Protocolo registrado com sucesso.
Status atual: ${protocolo.status}
`;
  }

  /* ===================== ORQUESTRAÇÃO FINAL ===================== */
  async executarFluxoCompleto(input: {
    pessoa: any;
    protocolo: any;
  }) {

    // 1️⃣ LLaMA decide
    const decisao = await this.executarLLaMA(input.protocolo);

    // 2️⃣ Gemini explica
    const mensagem = await this.executarGemini(
      { nome: input.pessoa.nome, tipo: decisao.tipoPessoa },
      input.protocolo
    );

    // 3️⃣ Retorno unificado
    return {
      decisaoLLaMA: decisao,
      mensagemGemini: mensagem
    };
  }
}
