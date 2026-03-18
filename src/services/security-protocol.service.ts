
import { Injectable, inject } from '@angular/core';
import { DbService, Morador } from './db.service';
import { OcrExtractionResult } from './gemini.service';

export interface SecurityVerdict {
  status: 'SAFE' | 'WARNING' | 'CRITICAL';
  reason: string;
  protocol: string;
}

@Injectable({
  providedIn: 'root'
})
export class SecurityProtocolService {
  private db = inject(DbService);

  analyze(data: OcrExtractionResult, moradores: Morador[]): SecurityVerdict {
    // 1. Check for unknown recipient
    const recipientFound = data.matchedMoradorId || moradores.some(m => 
      m.nome.toUpperCase().includes(data.destinatario.toUpperCase())
    );

    if (!recipientFound && data.destinatario) {
      return {
        status: 'WARNING',
        reason: 'Destinatário não encontrado no banco de dados do condomínio.',
        protocol: 'Verificar documento de identidade e confirmar unidade de destino.'
      };
    }

    // 2. Check for suspicious transportadora
    const suspiciousCarriers = ['DESCONHECIDO', 'PARTICULAR', 'MOTOBOY'];
    if (suspiciousCarriers.includes(data.transportadora.toUpperCase())) {
      return {
        status: 'WARNING',
        reason: 'Transportadora não convencional detectada.',
        protocol: 'Inspecionar integridade da embalagem antes de aceitar.'
      };
    }

    // 3. Check for missing critical data
    if (!data.destinatario || (!data.bloco && !data.apto)) {
      return {
        status: 'CRITICAL',
        reason: 'Dados insuficientes para identificação segura.',
        protocol: 'Recusar recebimento ou realizar conferência manual rigorosa.'
      };
    }

    // 4. Default Safe
    return {
      status: 'SAFE',
      reason: 'Dados validados com sucesso.',
      protocol: 'Seguir fluxo normal de recebimento.'
    };
  }
}
