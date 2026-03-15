import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';

@Injectable({ providedIn: 'root' })
export class SimbiosePdfService {

  gerarComprovante(protocolo: any): Blob {
    const pdf = new jsPDF();

    pdf.setFontSize(14);
    pdf.text('PROTOCOLO INTELIGENTE — SIMBIOSE', 20, 20);

    pdf.setFontSize(10);
    pdf.text(`ID: ${protocolo.id || ''}`, 20, 35);
    pdf.text(`Tipo: ${protocolo.tipo || ''}`, 20, 45);
    pdf.text(`Destinatário: ${protocolo.destinatario || ''}`, 20, 55);
    pdf.text(`Bloco: ${protocolo.bloco || ''}`, 20, 65);
    pdf.text(`Unidade: ${protocolo.unidade || ''}`, 20, 75);
    pdf.text(`Condição: ${protocolo.condicao || ''}`, 20, 85);
    pdf.text(`Data: ${new Date().toLocaleString()}`, 20, 95);

    return pdf.output('blob');
  }
}
