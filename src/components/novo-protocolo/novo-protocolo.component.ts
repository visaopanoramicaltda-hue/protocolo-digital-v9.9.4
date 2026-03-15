
import { Component, inject } from '@angular/core';
import { SimbioseWhatsappService } from '../../services/core/simbiose-whatsapp.service';
import { SimbiosePdfService } from '../../services/core/simbiose-pdf.service';
import { SimbioseStorageService } from '../../services/core/simbiose-storage.service';
import { SimbioseKillSwitchService } from '../../services/core/simbiose-kill-switch.service';
import { SimbioseHashService } from '../../services/core/simbiose-hash.service';
import { SimbioseAuditService } from '../../services/core/simbiose-audit.service';
import { SimbioseOrquestradorService } from '../../services/core/simbiose-orquestrador.service';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DbService } from '../../services/db.service';

@Component({
  selector: 'app-novo-protocolo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="h-full bg-gray-100 dark:bg-piano-900 p-8 flex flex-col items-center justify-center overflow-y-auto">
      <div class="bg-white dark:bg-piano-800 p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-gray-200 dark:border-piano-700 my-auto">
        <h2 class="text-2xl font-black mb-6 text-gray-800 dark:text-white uppercase">Teste de Integração (Offline)</h2>
        <p class="mb-6 text-gray-600 dark:text-gray-300 text-sm">Esta ação executa o fluxo seguro 100% local: Kill Switch (simulado), Orquestração IA, Hash, Auditoria e Notificação.</p>
        
        <button (click)="testar()" [disabled]="loading" class="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 mb-4">
          <span *ngIf="loading" class="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></span>
          {{ loading ? 'PROCESSANDO...' : 'GERAR PROTOCOLO IA' }}
        </button>

        <button (click)="voltar()" class="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white text-sm font-bold underline">
          Voltar para Dashboard
        </button>

        @if (statusMessage) {
          <div class="mt-6 p-4 rounded-xl text-sm font-mono text-left overflow-auto max-h-60" 
               [class.bg-green-100]="statusType === 'SUCCESS'" [class.text-green-800]="statusType === 'SUCCESS'"
               [class.bg-red-100]="statusType === 'ERROR'" [class.text-red-800]="statusType === 'ERROR'">
            <pre class="whitespace-pre-wrap">{{ statusMessage }}</pre>
          </div>
        }
      </div>
    </div>
  `
})
export class NovoProtocoloComponent {
  private db = inject(DbService);
  private whatsapp = inject(SimbioseWhatsappService);
  private pdfService = inject(SimbiosePdfService);
  private storage = inject(SimbioseStorageService);
  private killSwitch = inject(SimbioseKillSwitchService);
  private hashService = inject(SimbioseHashService);
  private audit = inject(SimbioseAuditService);
  private orquestrador = inject(SimbioseOrquestradorService);
  private router = inject(Router);
  
  loading = false;
  statusMessage = '';
  statusType: 'SUCCESS' | 'ERROR' = 'SUCCESS';

  async testar() {
    this.loading = true;
    this.statusMessage = 'Iniciando verificação de segurança...';

    try {
      // 0. Kill Switch (Segurança) - Agora opera localmente
      await this.killSwitch.verificar();
      this.statusMessage += '\nSistema Operacional: ATIVO.';

      // 1. Criar dados do Protocolo (local)
      const dadosPessoa = {
        nome: 'Carlos Silva (Teste Offline)',
        tipo: 'MORADOR' as const,
        telefone: '11999999999'
      };
      const pessoaId = crypto.randomUUID();
      this.statusMessage += '\nPessoa criada (localmente).';

      const protocoloId = crypto.randomUUID();
      const dadosProtocolo = {
        id: protocoloId,
        pessoa_id: pessoaId,
        tipo: 'ENCOMENDA' as const,
        status: 'PENDENTE' as 'PENDENTE',
        bloco: 'A',
        unidade: '101',
        condicao: 'Intacta',
        transportadora: 'Amazon Logistics',
      };
      
      // Mapping 'unidade' to 'apto' for Encomenda interface and casting status correctly
      await this.db.addEncomenda({ 
        ...dadosProtocolo, 
        apto: dadosProtocolo.unidade,
        dataEntrada: new Date().toISOString(), 
        porteiroEntradaId: 'test', 
        destinatarioNome: dadosPessoa.nome 
      });
      this.statusMessage += '\nProtocolo criado (localmente).';

      // 3. Gerar PDF
      const blobPdf = this.pdfService.gerarComprovante({
        ...dadosProtocolo,
        destinatario: dadosPessoa.nome
      });
      this.statusMessage += '\nPDF gerado (localmente).';

      // 4. Gerar Hash e Auditar (Integridade)
      const hash = await this.hashService.gerarHash(blobPdf);
      this.statusMessage += `\nIntegridade SHA-256: ${hash.substring(0, 10)}...`;

      await this.audit.registrarEvento({
        protocoloId: protocoloId,
        tipo: 'ENCOMENDA',
        evento: 'ENTRADA',
        hash: hash
      });
      this.statusMessage += '\nAuditoria registrada (localmente).';

      // 5. "Upload" PDF (gera URL local)
      const link = await this.storage.uploadPdf(protocoloId, blobPdf);
      this.statusMessage += `\n"Upload" concluído (URL local: ${link.substring(0,20)}...).`;

      // 6. Inteligência Híbrida (LLaMA + Gemini)
      const iaResultado = await this.orquestrador.executarFluxoCompleto({
        pessoa: { nome: dadosPessoa.nome, tipo: dadosPessoa.tipo },
        protocolo: dadosProtocolo
      });
      this.statusMessage += `\n\n[IA] LLaMA Decisão: ${iaResultado.decisaoLLaMA.risco} | ${iaResultado.decisaoLLaMA.fluxo}`;
      this.statusMessage += `\n[IA] Gemini: Mensagem gerada.`;

      // 7. Enviar WhatsApp com mensagem da IA
      this.whatsapp.enviar(
        {
          nome: dadosPessoa.nome,
          tipo: iaResultado.decisaoLLaMA.tipoPessoa,
          telefone: dadosPessoa.telefone
        },
        {
          id: protocoloId,
          tipo: dadosProtocolo.tipo,
          bloco: dadosProtocolo.bloco,
          unidade: dadosProtocolo.unidade,
          condicao: dadosProtocolo.condicao,
          status: dadosProtocolo.status,
          link: link
        },
        iaResultado.mensagemGemini
      );

      this.statusType = 'SUCCESS';
      this.statusMessage += '\n\nFLUXO 100% OFFLINE COMPLETO! 🚀';

    } catch (e: any) {
      this.statusType = 'ERROR';
      this.statusMessage += `\nERRO FATAL: ${e.message || JSON.stringify(e)}`;
      console.error(e);
    } finally {
      this.loading = false;
    }
  }

  voltar() {
    this.router.navigate(['/dashboard']);
  }
}
