import { Injectable, inject } from '@angular/core';
import { PdfService } from '../pdf.service';

@Injectable({ providedIn: 'root' })
export class SimbiosePdfService {
  private pdfService = inject(PdfService);

  async gerarComprovante(protocolo: any): Promise<Blob> {
    const colEsq = [
        { label: 'Tipo', value: protocolo.tipo || '' },
        { label: 'Destinatário', value: protocolo.destinatario || '' },
        { label: 'Condição', value: protocolo.condicao || '' }
    ];

    const colDir = [
        { label: 'Bloco', value: protocolo.bloco || '' },
        { label: 'Unidade', value: protocolo.unidade || '' },
        { label: 'Data', value: new Date().toLocaleString() }
    ];

    const result = await this.pdfService.criarPDFModerno(
        'PROTOCOLO INTELIGENTE',
        protocolo.id || 'N/A',
        'Este documento é um comprovante gerado pelo sistema Simbiose.',
        colEsq,
        colDir,
        [],
        undefined
    );

    return result.blob;
  }
}
