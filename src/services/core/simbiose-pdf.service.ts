import { Injectable, inject } from '@angular/core';
import { PdfService } from '../pdf.service';

@Injectable({ providedIn: 'root' })
export class SimbiosePdfService {
  private pdfService = inject(PdfService);

  async gerarComprovante(protocolo: Record<string, unknown>): Promise<Blob> {
    const colEsq = [
        { label: 'Tipo', value: String(protocolo['tipo'] || '') },
        { label: 'Destinatário', value: String(protocolo['destinatario'] || '') },
        { label: 'Condição', value: String(protocolo['condicao'] || '') }
    ];

    const colDir = [
        { label: 'Bloco', value: String(protocolo['bloco'] || '') },
        { label: 'Unidade', value: String(protocolo['unidade'] || '') },
        { label: 'Data', value: new Date().toLocaleString() }
    ];

    const result = await this.pdfService.criarPDFModerno(
        'PROTOCOLO INTELIGENTE',
        (protocolo['id'] as string) || 'N/A',
        'Este documento é um comprovante gerado pelo sistema Simbiose.',
        colEsq,
        colDir,
        [],
        undefined
    );

    return result.blob;
  }
}
