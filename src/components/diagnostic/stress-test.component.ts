import { Component, inject, signal } from '@angular/core';
import { SecurityProtocolService } from '../../services/security-protocol.service';
import { DbService, Morador, Encomenda } from '../../services/db.service';
import { OcrExtractionResult } from '../../services/gemini.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stress-test',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6 max-w-4xl mx-auto">
      <h1 class="text-3xl font-bold mb-6 text-slate-800">Painel de Diagnóstico & Estresse</h1>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
            <span class="w-2 h-2 bg-blue-500 rounded-full"></span>
            Simulação de Dados
          </h2>
          <p class="text-sm text-slate-500 mb-6">Gera 10.000 moradores e 10.000 encomendas no banco de dados local para testar a performance da interface.</p>
          
          <div class="flex flex-col gap-3">
            <button 
              (click)="simulateMassiveData()" 
              [disabled]="isRunning()"
              class="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              @if (isRunning()) {
                <span class="animate-spin text-lg">⏳</span>
              }
              Gerar 20.000 Registros
            </button>
            
            <button 
              (click)="clearAllData()" 
              [disabled]="isRunning()"
              class="w-full bg-white border border-red-200 text-red-600 hover:bg-red-50 disabled:bg-slate-50 disabled:text-slate-400 font-medium py-3 px-4 rounded-xl transition-all"
            >
              Limpar Banco de Dados
            </button>
          </div>
        </div>

        <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h2 class="text-lg font-semibold mb-4 flex items-center gap-2">
            <span class="w-2 h-2 bg-emerald-500 rounded-full"></span>
            Teste de Algoritmo
          </h2>
          <p class="text-sm text-slate-500 mb-6">Executa 1 milhão de iterações do algoritmo de análise de segurança para medir a velocidade de processamento da CPU.</p>
          
          <button 
            (click)="runStressTest()" 
            [disabled]="isRunning()"
            class="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-medium py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            @if (isRunning()) {
              <span class="animate-spin text-lg">⏳</span>
            }
            Executar 1 Milhão de Ciclos
          </button>
        </div>
      </div>
      
      @if (isRunning()) {
        <div class="bg-blue-50 border border-blue-100 p-4 rounded-xl mb-6 flex items-center gap-3">
          <div class="animate-pulse bg-blue-400 w-3 h-3 rounded-full"></div>
          <span class="text-blue-700 font-medium">Processando carga de estresse... Por favor, aguarde.</span>
        </div>
      }

      @if (result()) {
        <div class="bg-slate-900 text-white p-6 rounded-2xl shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h3 class="text-emerald-400 font-bold uppercase tracking-wider text-xs mb-4">Resultado do Teste</h3>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p class="text-slate-400 text-xs mb-1">Status</p>
              <p class="text-lg font-mono">{{ result()?.status }}</p>
            </div>
            <div>
              <p class="text-slate-400 text-xs mb-1">Tempo Total</p>
              <p class="text-lg font-mono">{{ result()?.timeTaken }}ms</p>
            </div>
            <div>
              <p class="text-slate-400 text-xs mb-1">Registros/Ciclos</p>
              <p class="text-lg font-mono">{{ result()?.patternsProcessed?.toLocaleString() }}</p>
            </div>
            <div>
              <p class="text-slate-400 text-xs mb-1">Eficiência</p>
              <p class="text-lg font-mono text-emerald-400">{{ calculateEfficiency() }} ops/ms</p>
            </div>
          </div>
        </div>
      }
    </div>
  `
})
export class StressTestComponent {
  private securityService = inject(SecurityProtocolService);
  private dbService = inject(DbService);
  
  isRunning = signal(false);
  result = signal<{ status: string, timeTaken: number, patternsProcessed: number } | null>(null);

  calculateEfficiency() {
    const res = this.result();
    if (!res || res.timeTaken === 0) return 0;
    return Math.round(res.patternsProcessed / res.timeTaken);
  }

  async simulateMassiveData() {
    this.isRunning.set(true);
    const startTime = performance.now();
    
    try {
      const tenantId = this.dbService.currentTenantId() || 'stress_test_tenant';
      const adminId = this.dbService.porteiros().find(p => p.isAdmin)?.id || 'system';

      // 1. Gerar 10.000 Moradores
      const novosMoradores: Morador[] = [];
      for (let i = 0; i < 10000; i++) {
        novosMoradores.push({
          id: `stress_m_${i}`,
          nome: `MORADOR DE TESTE ${i}`,
          bloco: `${Math.floor(i / 100)}`,
          apto: `${i % 100}`,
          telefone: `(11) 9${Math.floor(Math.random() * 90000000 + 10000000)}`,
          condoId: tenantId,
          isPrincipal: i % 3 === 0
        });
      }

      // 2. Gerar 10.000 Encomendas
      const novasEncomendas: Encomenda[] = [];
      const transportadoras = ['CORREIOS', 'MERCADO LIVRE', 'AMAZON', 'LOGGI', 'JADLOG'];
      for (let i = 0; i < 10000; i++) {
        novasEncomendas.push({
          id: `stress_e_${i}`,
          destinatarioNome: `MORADOR DE TESTE ${Math.floor(Math.random() * 10000)}`,
          bloco: `${Math.floor(Math.random() * 100)}`,
          apto: `${Math.floor(Math.random() * 100)}`,
          transportadora: transportadoras[Math.floor(Math.random() * transportadoras.length)],
          status: i % 5 === 0 ? 'ENTREGUE' : 'PENDENTE',
          dataEntrada: new Date().toISOString(),
          porteiroEntradaId: adminId,
          condoId: tenantId
        });
      }

      // 3. Salvar no Banco
      await this.dbService.saveMany('moradores', novosMoradores);
      await this.dbService.saveMany('encomendas', novasEncomendas);

      // 4. Atualizar Signals
      this.dbService.moradores.set([...this.dbService.moradores(), ...novosMoradores]);
      this.dbService.encomendas.set([...this.dbService.encomendas(), ...novasEncomendas]);

      const endTime = performance.now();
      this.result.set({
        status: 'Dados Gerados',
        timeTaken: Math.round(endTime - startTime),
        patternsProcessed: 20000
      });

    } catch (e) {
      console.error('Stress test failed:', e);
      this.result.set({ status: 'Erro', timeTaken: 0, patternsProcessed: 0 });
    } finally {
      this.isRunning.set(false);
    }
  }

  async clearAllData() {
    if (!confirm('Isso irá apagar TODOS os moradores e encomendas. Continuar?')) return;
    
    this.isRunning.set(true);
    try {
      // IndexedDB clear is better but we don't have a direct method exposed for clear all
      // We'll use the IDs we know or just reload
      const mIds = this.dbService.moradores().map(m => m.id);
      const eIds = this.dbService.encomendas().map(e => e.id);
      
      await this.dbService.deleteMany('moradores', mIds);
      await this.dbService.deleteMany('encomendas', eIds);
      
      this.dbService.moradores.set([]);
      this.dbService.encomendas.set([]);
      
      this.result.set({ status: 'Banco Limpo', timeTaken: 0, patternsProcessed: mIds.length + eIds.length });
    } finally {
      this.isRunning.set(false);
    }
  }

  async runStressTest() {
    this.isRunning.set(true);
    
    const moradores = this.dbService.moradores();
    const patterns: OcrExtractionResult[] = [];
    for (let i = 0; i < 599; i++) {
      patterns.push({
        destinatario: i % 10 === 0 ? 'UNKNOWN' : `Morador ${i}`,
        localizacao: `BL ${i % 5} AP ${i % 100}`,
        transportadora: i % 20 === 0 ? 'PARTICULAR' : 'CORREIOS',
        confianca: 0.9,
        bloco: `${i % 5}`,
        apto: `${i % 100}`
      } as OcrExtractionResult);
    }

    const iterations = 1000000;
    const startTime = performance.now();
    
    // Use a small delay to allow UI to update if needed, but here we want pure CPU stress
    for (let i = 0; i < iterations; i++) {
      const pattern = patterns[i % 599];
      this.securityService.analyze(pattern, moradores);
    }
    
    const endTime = performance.now();
    
    this.result.set({
      status: 'Ciclos Completos',
      timeTaken: Math.round(endTime - startTime),
      patternsProcessed: iterations
    });
    this.isRunning.set(false);
  }
}
