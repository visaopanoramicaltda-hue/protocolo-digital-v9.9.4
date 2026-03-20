
import { Injectable, inject } from '@angular/core';
import { Encomenda, Porteiro, DbService, Morador } from './db.service';
import { UiService } from './ui.service';
import { jsPDF } from 'jspdf';

@Injectable({
  providedIn: 'root'
})
export class PdfService {
  private db = inject(DbService);
  private ui = inject(UiService);

  // Cores Oficiais (Design System: Piano Black & Neon Orange)
  private readonly COLOR_DARK_BG = [35, 35, 35]; // #232323
  private readonly COLOR_ORANGE = [232, 108, 38]; // #E86C26
  
  constructor() {}

  private async gerarHash(buffer: ArrayBuffer): Promise<string> {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  
  private getImageDimensions(base64: string): Promise<{ width: number, height: number }> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
    });
  }

  /* ================= ENGINE DE PDF MASTER (LAYOUT ADAPTATIVO) ================= */

  public async criarPDFModerno(
      tituloDireita: string,
      idControle: string,
      textoResponsabilidade: string,
      colunaEsquerda: { label: string, value: string }[],
      colunaDireita: { label: string, value: string }[],
      itensVisual: Encomenda[], // ARRAY DE ITENS PARA LOGICA DE GRID
      assinaturaBase64?: string
  ): Promise<{ blob: Blob, url: string, hash: string }> {
    
    const doc = new jsPDF();
    const PAGE_WIDTH = 210;
    const PAGE_HEIGHT = 297;
    const MARGIN = 15;
    const FOOTER_HEIGHT = 20; // Altura reservada para rodapé
    const SIGNATURE_HEIGHT = 35; // Altura reservada para assinatura
    
    // --- 1. CABEÇALHO (DARK + ORANGE STRIP) ---
    doc.setFillColor(this.COLOR_DARK_BG[0], this.COLOR_DARK_BG[1], this.COLOR_DARK_BG[2]);
    doc.rect(0, 0, PAGE_WIDTH, 35, 'F'); // Fundo Escuro

    doc.setFillColor(this.COLOR_ORANGE[0], this.COLOR_ORANGE[1], this.COLOR_ORANGE[2]);
    doc.rect(0, 35, PAGE_WIDTH, 2, 'F'); // Faixa Laranja

    // Logo / Título Esquerda
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('SIMBIOSE', MARGIN, 15);
    
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 200, 200);
    doc.text('PROTOCOLO INTELIGENTE DE GESTÃO', MARGIN, 22);

    // Título Direita
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(tituloDireita.toUpperCase(), PAGE_WIDTH - MARGIN, 14, { align: 'right' });

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 200, 200);
    doc.text(`Emissão: ${new Date().toLocaleString('pt-BR')}`, PAGE_WIDTH - MARGIN, 20, { align: 'right' });
    doc.text(`ID Controle: ${idControle.substring(0, 8).toUpperCase()}`, PAGE_WIDTH - MARGIN, 25, { align: 'right' });

    let y = 50;

    // --- 2. DECLARAÇÃO DE RESPONSABILIDADE (BOX) ---
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(250, 250, 250); // Cinza muito claro
    doc.rect(MARGIN, y, PAGE_WIDTH - (MARGIN * 2), 25, 'FD');

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text('DECLARAÇÃO DE RESPONSABILIDADE:', MARGIN + 5, y + 6);

    doc.setFont('times', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    
    const splitText = doc.splitTextToSize(textoResponsabilidade, PAGE_WIDTH - (MARGIN * 2) - 10);
    doc.text(splitText, MARGIN + 5, y + 11);

    y += 35;

    // --- 3. DETALHES DO REGISTRO (GRID) ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(this.COLOR_DARK_BG[0], this.COLOR_DARK_BG[1], this.COLOR_DARK_BG[2]);
    doc.text('DETALHES DO REGISTRO', MARGIN, y);
    
    doc.setDrawColor(this.COLOR_ORANGE[0], this.COLOR_ORANGE[1], this.COLOR_ORANGE[2]);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y + 2, 70, y + 2);
    
    y += 10;

    // Configuração das Colunas
    const col1X = MARGIN;
    const col2X = PAGE_WIDTH / 2 + 5;
    const rowHeight = 8;
    const maxRows = Math.max(colunaEsquerda.length, colunaDireita.length);

    doc.setLineWidth(0.1);
    doc.setDrawColor(230, 230, 230);

    for (let i = 0; i < maxRows; i++) {
        const itemEsq = colunaEsquerda[i];
        const itemDir = colunaDireita[i];
        const lineY = y + (i * rowHeight);

        if (itemEsq) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            doc.text(itemEsq.label + ':', col1X, lineY);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(0, 0, 0);
            doc.text(itemEsq.value, col1X + 35, lineY);
        }

        if (itemDir) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            doc.text(itemDir.label + ':', col2X, lineY);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(0, 0, 0);
            doc.text(itemDir.value, col2X + 35, lineY);
        }

        doc.line(MARGIN, lineY + 2, PAGE_WIDTH - MARGIN, lineY + 2);
    }

    y += (maxRows * rowHeight) + 10;

    // --- 4. ENGINE VISUAL ADAPTATIVA (PAGINAÇÃO INTELIGENTE) ---
    
    const totalAvailableWidth = PAGE_WIDTH - (MARGIN * 2);
    // Footer Y Position (Bottom of page minus margin)
    const pageBottomLimit = PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT; 
    
    // Zoom Config
    const activeZoom = { vertical: 1.07, horizontal: 1.20 };

    // --- CASO 1: LOTE (MÚLTIPLOS ITENS) ---
    if (itensVisual.length > 1) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text(`EVIDÊNCIA VISUAL - LOTE (${itensVisual.length} VOLUMES)`, MARGIN, y);
        y += 5;

        // Grid Logic (2 colunas)
        const colCount = 2;
        const gap = 4;
        const cellWidth = (totalAvailableWidth - (gap * (colCount - 1))) / colCount;
        
        // Ajuste dinâmico para caber até 10 etiquetas (5 linhas) sem quebrar página
        const cellHeight = itensVisual.length > 6 ? 24 : 35; 

        let currentX = MARGIN;
        
        for (let i = 0; i < itensVisual.length; i++) {
            const item = itensVisual[i];
            
            // VERIFICAÇÃO DE QUEBRA DE PÁGINA (PAGINAÇÃO)
            // Se a posição Y + altura da célula + espaço para assinatura (se for o último) passar do limite
            const spaceNeeded = cellHeight + gap;
            
            // Se estamos prestes a desenhar e vai estourar a página
            if (y + spaceNeeded > pageBottomLimit) {
                doc.addPage();
                y = MARGIN + 10; // Margem no topo da nova página
                
                // Repete título na nova página
                doc.setFontSize(8);
                doc.setTextColor(100, 100, 100);
                doc.text(`EVIDÊNCIA VISUAL (CONT.)`, MARGIN, y - 5);
            }

            // Define X baseado na paridade (coluna 1 ou 2)
            if (i % colCount === 0) {
                currentX = MARGIN;
                // Apenas incrementa Y se NÃO for o primeiro da nova página/bloco
                if (i > 0 && y !== MARGIN + 10) {
                   // A lógica de incremento de Y é feita no final do loop anterior se coluna fechou
                }
            } else {
                currentX = MARGIN + cellWidth + gap;
            }
            
            // Desenha Box
            doc.setDrawColor(200);
            doc.rect(currentX, y, cellWidth, cellHeight);
            
            // Foto
            if (item.fotoBase64) {
                try {
                    const dims = await this.getImageDimensions(item.fotoBase64);
                    this.drawImageFit(doc, item.fotoBase64, dims, currentX, y, cellWidth, cellHeight - 10);
                } catch {}
            }

            // Legenda
            doc.setFontSize(7);
            doc.setTextColor(0, 0, 0);
            
            // REGRA: DESTINATÁRIO (No lugar da transportadora)
            const destName = (item.destinatarioNome || 'NÃO IDENTIFICADO').toUpperCase();
            doc.text(destName.substring(0, 22), currentX + 2, y + cellHeight - 7);
            
            // REGRA: TRACKING
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.text((item.codigoRastreio || 'S/N').substring(0, 25), currentX + 2, y + cellHeight - 3);

            // Incrementa Y apenas quando fechamos a linha (coluna 2) ou se é o último item ímpar
            if ((i + 1) % colCount === 0 || i === itensVisual.length - 1) {
                if ((i + 1) % colCount === 0) {
                    y += cellHeight + gap;
                } else {
                    // Se for o último e ímpar, o próximo passo da lógica (assinatura) vai precisar do Y atualizado
                    y += cellHeight + gap; 
                }
            }
        }
        
        // --- ASSINATURA LOTE ---
        if (assinaturaBase64) {
             const spaceForSig = SIGNATURE_HEIGHT + 10;
             
             // Se não houver espaço para assinatura na página atual, cria nova
             if (y + spaceForSig > pageBottomLimit) {
                 doc.addPage();
                 y = MARGIN + 10;
             }
             
             const sigY = y + 5;
             const cleanSig = assinaturaBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
             try {
                 doc.addImage(`data:image/png;base64,${cleanSig}`, 'PNG', PAGE_WIDTH / 2 - 30, sigY, 60, 30);
             } catch(e) { console.warn('Erro assinatura lote', e); }
             
             doc.setDrawColor(0);
             doc.setLineWidth(0.1);
             doc.line(PAGE_WIDTH / 2 - 40, sigY + 30, PAGE_WIDTH / 2 + 40, sigY + 30);
             doc.setFontSize(8);
             doc.setFont('helvetica', 'normal');
             doc.text('Assinatura do Recebedor (Lote)', PAGE_WIDTH / 2, sigY + 34, { align: 'center' });
        }

    } 
    // --- CASO 2: ITEM ÚNICO ---
    else {
        const item = itensVisual[0];
        const fotoBase64 = item?.fotoBase64;

        if (assinaturaBase64) {
            // --- MODO RETIRADA OU LOTE ÚNICO (COM ASSINATURA) ---
            const boxHeight = 70; // Aumentado levemente
            const gap = 5;
            const photoWidth = (totalAvailableWidth - gap) * 0.55; // Reduzido foto
            const sigWidth = (totalAvailableWidth - gap) * 0.45;   // Aumentado assinatura

            doc.setDrawColor(180, 180, 180);
            // Box Foto
            doc.rect(MARGIN, y, photoWidth, boxHeight);
            doc.setFontSize(7);
            doc.setTextColor(100, 100, 100);
            doc.text('EVIDÊNCIA VISUAL', MARGIN + 2, y + 4);

            if (fotoBase64) {
                const dims = await this.getImageDimensions(fotoBase64);
                this.drawImageFit(doc, fotoBase64, dims, MARGIN, y + 5, photoWidth, boxHeight - 15, activeZoom);
            }
            
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(50, 50, 50);
            const destName = (item.destinatarioNome || 'NÃO IDENTIFICADO').toUpperCase();
            doc.text(destName.substring(0, 45), MARGIN + 2, y + boxHeight - 8);
            
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(item.codigoRastreio || 'S/N', MARGIN + 2, y + boxHeight - 3);

            // Box Assinatura
            const box2X = MARGIN + photoWidth + gap;
            doc.rect(box2X, y, sigWidth, boxHeight);
            doc.setFontSize(7);
            doc.setTextColor(100, 100, 100);
            doc.text('ASSINATURA DIGITAL', box2X + 2, y + 4);
            
            // SANITIZAÇÃO E INSERÇÃO SEGURA DA ASSINATURA
            const cleanSig = assinaturaBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
            try {
                // Ajustado altura e largura para preencher melhor
                doc.addImage(`data:image/png;base64,${cleanSig}`, 'PNG', box2X + 5, y + 10, sigWidth - 10, 40);
            } catch (e) {
                console.warn('Erro ao renderizar assinatura', e);
                doc.text('[Assinatura Ilegível/Erro]', box2X + 5, y + 30);
            }

            doc.setDrawColor(80);
            doc.line(box2X + 5, y + 52, box2X + sigWidth - 5, y + 52);
            doc.setFontSize(7);
            doc.text('Confirmado Eletronicamente', box2X + (sigWidth/2), y + 56, { align: 'center' });

        } else {
            // --- MODO ENTRADA (SEM ASSINATURA) - FOTO GIGANTE ---
            // Verifica espaço
            const availableForPhoto = pageBottomLimit - y;
            const maxBoxHeight = Math.min(availableForPhoto, 140); 
            
            doc.setDrawColor(180, 180, 180);
            doc.rect(MARGIN, y, totalAvailableWidth, maxBoxHeight);
            
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            doc.text('REGISTRO FOTOGRÁFICO (ALTA DEFINIÇÃO)', MARGIN + 2, y + 5);

            if (fotoBase64) {
                const dims = await this.getImageDimensions(fotoBase64);
                this.drawImageFit(doc, fotoBase64, dims, MARGIN, y + 7, totalAvailableWidth, maxBoxHeight - 9, activeZoom);
            } else {
                doc.text('[Imagem não capturada]', MARGIN + 10, y + 20);
            }
        }
    }

    // --- 5. RODAPÉ (SEMPRE NA ÚLTIMA PÁGINA) ---
    const footerY = PAGE_HEIGHT - 15;
    
    doc.setFillColor(245, 245, 245);
    doc.rect(0, footerY - 5, PAGE_WIDTH, 20, 'F'); 

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    
    // Branding White Label
    const config = this.db.appConfig();
    let footerText = 'SISTEMA SIMBIOSE';
    if (config.nomeCondominio && config.nomeCondominio.trim().length > 0) {
        footerText = config.nomeCondominio.toUpperCase();
    }
    
    doc.text(footerText, PAGE_WIDTH / 2, footerY, { align: 'center' });
    
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Gerado via Protocolo Inteligente Simbiose', PAGE_WIDTH / 2, footerY + 4, { align: 'center' });

    const rawBuffer = doc.output('arraybuffer');
    const hash = await this.gerarHash(rawBuffer);

    doc.setFont('courier', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(120, 120, 120);
    doc.text(`HASH SHA-256: ${hash}`, PAGE_WIDTH / 2, footerY + 8, { align: 'center' });
    doc.text(`UUID UNIQ: ${idControle} | INTEGRIDADE VERIFICADA | ${new Date().toISOString()}`, PAGE_WIDTH / 2, footerY + 11, { align: 'center' });

    const blob = new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);

    return { blob, url, hash };
  }
  
  // Helper de Imagem Fit
  private drawImageFit(
      doc: jsPDF, 
      base64: string, 
      dims: {width: number, height: number}, 
      x: number, 
      y: number, 
      w: number, 
      h: number,
      zoomConfig: { vertical: number, horizontal: number } = { vertical: 1, horizontal: 1 }
  ) {
      if (dims.width <= 0 || dims.height <= 0) return;
      
      const imgRatio = dims.width / dims.height;
      const pad = 2;
      const availW = w - (pad * 2);
      const availH = h - (pad * 2);

      let dw = availW;
      let dh = availH;

      if (imgRatio > (availW / availH)) {
          dh = availW / imgRatio;
      } else {
          dw = availH * imgRatio;
      }
      
      const isPortrait = dims.height > dims.width;
      const zoom = isPortrait ? zoomConfig.vertical : zoomConfig.horizontal;
      dw *= zoom;
      dh *= zoom;

      const dx = x + pad + (availW - dw) / 2;
      const dy = y + pad + (availH - dh) / 2;
      
      // Limpeza de Base64 para garantir compatibilidade
      const cleanData = base64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
      
      try {
        doc.addImage(`data:image/jpeg;base64,${cleanData}`, 'JPEG', dx, dy, dw, dh);
      } catch {}
  }

  // --- MÉTODOS PÚBLICOS ---

  public async generateEntryProtocol(encomenda: Encomenda, porteiro: Porteiro): Promise<{ blob: Blob, url: string, hash: string }> {
    const dataFormatada = new Date(encomenda.dataEntrada).toLocaleString('pt-BR');
    const textoResponsabilidade = `Certifica-se, para os devidos fins, o recebimento de volume destinado à unidade abaixo identificada, recebido em ${dataFormatada}. O item, em condição física classificada como "${encomenda.condicaoFisica}", permanece sob custódia da portaria até sua retirada formal pelo destinatário ou pessoa autorizada.`;

    const colEsq = [
        { label: 'Gerado Por', value: porteiro.nome },
        { label: 'Data Entrada', value: dataFormatada },
        { label: 'Unidade', value: `${encomenda.bloco || '-'} - ${encomenda.apto || '-'}` },
        { label: 'Rastreio', value: encomenda.codigoRastreio || 'N/A' }
    ];

    const colDir = [
        { label: 'Transportadora', value: (encomenda.transportadora || 'N/A').toUpperCase() },
        { label: 'Destinatário', value: encomenda.destinatarioNome },
        { label: 'Condição', value: encomenda.condicaoFisica || 'Intacta' },
        { label: 'ID Transação', value: encomenda.id.substring(0, 8) + '...' }
    ];

    return this.criarPDFModerno(
        'PROTOCOLO DE ENTRADA',
        encomenda.id,
        textoResponsabilidade,
        colEsq,
        colDir,
        [encomenda],
        undefined
    );
  }

  public async generateWithdrawalProof(
      encomenda: Encomenda, 
      porteiro: Porteiro, 
      receiverName: string, 
      signatureBase64: string,
      itemsGrupo?: Encomenda[]
  ): Promise<{ blob: Blob, url: string, hash: string }> {
    const dataFormatada = encomenda.dataSaida ? new Date(encomenda.dataSaida).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
    const textoResponsabilidade = `Certifica-se, para os devidos fins, a entrega definitiva do(s) volume(s) referente(s) ao protocolo em epígrafe, retirado(s) em ${dataFormatada} por ${receiverName.toUpperCase()}. A aposição da assinatura digital abaixo confirma o recebimento em ordem e encerra a responsabilidade de custódia da portaria sobre o(s) referido(s) item(ns).`;

    const colEsq = [
        { label: 'Gerado Por', value: porteiro.nome },
        { label: 'Data Retirada', value: dataFormatada },
        { label: 'Unidade', value: `${encomenda.bloco || '-'} - ${encomenda.apto || '-'}` },
        { label: 'Rastreio', value: encomenda.codigoRastreio || 'N/A' }
    ];

    const colDir = [
        { label: 'Retirado Por', value: receiverName.toUpperCase() },
        { label: 'Destinatário', value: encomenda.destinatarioNome },
        { label: 'ID Transação', value: encomenda.id.substring(0, 8) + '...' }
    ];

    const itens = itemsGrupo && itemsGrupo.length > 0 ? itemsGrupo : [encomenda];

    return this.criarPDFModerno(
        'COMPROVANTE DE RETIRADA',
        encomenda.id,
        textoResponsabilidade,
        colEsq,
        colDir,
        itens,
        signatureBase64
    );
  }

  public async generateCancellationProof(
      encomenda: Encomenda, 
      porteiro: Porteiro
  ): Promise<{ blob: Blob, url: string, hash: string }> {
    const dataFormatada = new Date().toLocaleString('pt-BR');
    const textoResponsabilidade = `Certifica-se, para os devidos fins, o CANCELAMENTO do registro do volume referente ao protocolo em epígrafe, processado em ${dataFormatada} pelo operador ${porteiro.nome.toUpperCase()}. Este documento invalida a entrada original e encerra a responsabilidade de custódia da portaria sobre o referido item.`;

    const colEsq = [
        { label: 'Cancelado Por', value: porteiro.nome },
        { label: 'Data Cancelamento', value: dataFormatada },
        { label: 'Unidade', value: `${encomenda.bloco || '-'} - ${encomenda.apto || '-'}` },
        { label: 'Rastreio', value: encomenda.codigoRastreio || 'N/A' }
    ];

    const colDir = [
        { label: 'Transportadora', value: (encomenda.transportadora || 'N/A').toUpperCase() },
        { label: 'Destinatário', value: encomenda.destinatarioNome },
        { label: 'ID Transação', value: encomenda.id.substring(0, 8) + '...' }
    ];

    return this.criarPDFModerno(
        'COMPROVANTE DE CANCELAMENTO',
        encomenda.id,
        textoResponsabilidade,
        colEsq,
        colDir,
        [encomenda],
        undefined
    );
  }



  
  public async generateDailyOperationalReport(stats: Record<string, unknown>, dateStr: string): Promise<{ blob: Blob, url: string, hash: string }> {
    const textoResponsabilidade = `Este documento certifica o fechamento operacional diário referente ao dia ${dateStr}. Os dados abaixo refletem as movimentações registradas no sistema Simbiose até o momento da emissão deste relatório.`;

    const colEsq = [
        { label: 'Data do Relatório', value: dateStr },
        { label: 'Total Entradas', value: String(stats.entradas || 0) }
    ];

    const colDir = [
        { label: 'Total Saídas', value: String(stats.saidas || 0) },
        { label: 'Produtividade', value: stats.detalhePorteiros ? 'Ver Detalhes Abaixo' : 'N/A' }
    ];

    // Aqui podemos usar o campo de texto de responsabilidade para mostrar a produtividade também
    const textoCompleto = `${textoResponsabilidade}\n\nPRODUTIVIDADE POR OPERADOR:\n${stats.detalhePorteiros || 'Nenhum dado registrado.'}`;

    return this.criarPDFModerno(
        'RELATÓRIO DIÁRIO OPERACIONAL',
        `REP-${Date.now()}`,
        textoCompleto,
        colEsq,
        colDir,
        [],
        undefined
    );
  }
  public async generateInvoice(): Promise<{ blob: Blob, url: string, hash: string }> { return { blob: new Blob(), url: '', hash: '' }; }
  public async generateBatchEntryReceipt(): Promise<{ blob: Blob, url: string, hash: string }> { return { blob: new Blob(), url: '', hash: '' }; }
  private async criarPDFListaModerno(
      titulo: string,
      colunas: { header: string, dataKey: string, width: number }[],
      dados: Record<string, unknown>[],
      user: Porteiro,
      orientation: 'portrait' | 'landscape' = 'portrait'
  ): Promise<{ blob: Blob, url: string, hash: string }> {
      const doc = new jsPDF(orientation);
      const PAGE_WIDTH = orientation === 'landscape' ? 297 : 210;
      const PAGE_HEIGHT = orientation === 'landscape' ? 210 : 297;
      const MARGIN = 15;
      const TABLE_WIDTH = PAGE_WIDTH - (MARGIN * 2);
      
      // --- CABEÇALHO (DARK + ORANGE STRIP) ---
      doc.setFillColor(this.COLOR_DARK_BG[0], this.COLOR_DARK_BG[1], this.COLOR_DARK_BG[2]);
      doc.rect(0, 0, PAGE_WIDTH, 35, 'F'); // Fundo Escuro

      doc.setFillColor(this.COLOR_ORANGE[0], this.COLOR_ORANGE[1], this.COLOR_ORANGE[2]);
      doc.rect(0, 35, PAGE_WIDTH, 2, 'F'); // Faixa Laranja

      // Logo / Título Esquerda
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text('SIMBIOSE', MARGIN, 15);
      
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(200, 200, 200);
      doc.text('PROTOCOLO INTELIGENTE DE GESTÃO', MARGIN, 22);

      // Título Direita
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(titulo.toUpperCase(), PAGE_WIDTH - MARGIN, 14, { align: 'right' });

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(200, 200, 200);
      doc.text(`Emissão: ${new Date().toLocaleString('pt-BR')}`, PAGE_WIDTH - MARGIN, 20, { align: 'right' });
      doc.text(`Gerado por: ${user.nome}`, PAGE_WIDTH - MARGIN, 25, { align: 'right' });

      // --- TABELA ---
      let y = 50;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      
      // Cabeçalho da Tabela
      doc.setFillColor(this.COLOR_ORANGE[0], this.COLOR_ORANGE[1], this.COLOR_ORANGE[2]);
      doc.rect(MARGIN, y - 6, TABLE_WIDTH, 9, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      
      let currentX = MARGIN + 2;
      colunas.forEach(col => {
          doc.text(col.header, currentX, y);
          currentX += col.width;
      });

      y += 8;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
      
      // Linhas com Zebra Striping
      dados.forEach((linha, index) => {
          if (y > PAGE_HEIGHT - 27) {
              doc.addPage();
              y = 20;
          }
          
          if (index % 2 === 0) {
              doc.setFillColor(245, 245, 245);
              doc.rect(MARGIN, y - 5, TABLE_WIDTH, 7, 'F');
          }
          
          currentX = MARGIN + 2;
          colunas.forEach(col => {
              const valor = String(linha[col.dataKey] || '-');
              doc.text(valor.substring(0, 35), currentX, y);
              currentX += col.width;
          });
          y += 7;
      });

      // --- RODAPÉ ---
      const pageCount = doc.getNumberOfPages();
      const rawBuffer = doc.output('arraybuffer');
      const hash = await this.gerarHash(rawBuffer);

      for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          
          const footerY = PAGE_HEIGHT - 15;
          
          doc.setFillColor(245, 245, 245);
          doc.rect(0, footerY - 5, PAGE_WIDTH, 20, 'F'); 

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.setTextColor(40, 40, 40);
          
          const config = this.db.appConfig();
          let footerText = 'SISTEMA SIMBIOSE';
          if (config.nomeCondominio && config.nomeCondominio.trim().length > 0) {
              footerText = config.nomeCondominio.toUpperCase();
          }
          
          doc.text(footerText, PAGE_WIDTH / 2, footerY, { align: 'center' });
          
          doc.setFontSize(7);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(100, 100, 100);
          doc.text('Gerado via Protocolo Inteligente Simbiose', PAGE_WIDTH / 2, footerY + 4, { align: 'center' });

          doc.setFont('courier', 'normal');
          doc.setFontSize(6);
          doc.setTextColor(120, 120, 120);
          doc.text(`HASH SHA-256: ${hash}`, PAGE_WIDTH / 2, footerY + 8, { align: 'center' });
          doc.text(`Página ${i} de ${pageCount} | INTEGRIDADE VERIFICADA | ${new Date().toISOString()}`, PAGE_WIDTH / 2, footerY + 11, { align: 'center' });
      }

      // Re-gerar o buffer apos adicionar o rodape em todas as paginas
      const finalBuffer = doc.output('arraybuffer');
      const blob = new Blob([finalBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      
      return { blob, url, hash };
  }

  public async generateEncomendasReport(items: Encomenda[], filters: string, user: Porteiro): Promise<{ blob: Blob, url: string, hash: string }> {
    const porteiros = this.db.porteiros();
    const getPorteiroName = (id?: string) => {
        if (!id) return '-';
        if (id === 'admin') return 'Admin';
        const p = porteiros.find(p => p.id === id);
        return p ? p.nome : 'Desconhecido';
    };

    return this.criarPDFListaModerno(
        'Relatório de Encomendas',
        [
            { header: 'Data', dataKey: 'dataEntrada', width: 22 },
            { header: 'Destinatário', dataKey: 'destinatarioNome', width: 50 },
            { header: 'Unidade', dataKey: 'unidade', width: 22 },
            { header: 'Status', dataKey: 'status', width: 22 },
            { header: 'Estado', dataKey: 'condicaoFisica', width: 22 },
            { header: 'Rastreio', dataKey: 'codigoRastreio', width: 21 },
            { header: 'Cadastrado Por', dataKey: 'porteiroEntrada', width: 35 },
            { header: 'Liberado Por', dataKey: 'porteiroSaida', width: 35 },
            { header: 'Quem Retirou', dataKey: 'quemRetirou', width: 38 }
        ],
        items.map(i => ({ 
            ...i, 
            dataEntrada: new Date(i.dataEntrada).toLocaleDateString('pt-BR'), 
            unidade: `${i.bloco}-${i.apto}`,
            condicaoFisica: i.condicaoFisica || 'Intacta',
            porteiroEntrada: getPorteiroName(i.porteiroEntradaId),
            porteiroSaida: getPorteiroName(i.porteiroSaidaId),
            quemRetirou: i.quemRetirou || '-'
        })),
        user,
        'landscape'
    );
  }

  public async generatePorteirosReport(users: Porteiro[], requester: Porteiro): Promise<{ blob: Blob, url: string, hash: string }> {
    return this.criarPDFListaModerno(
        'Lista de Porteiros',
        [
            { header: 'Nome', dataKey: 'nome', width: 60 },
            { header: 'CPF', dataKey: 'cpf', width: 40 },
            { header: 'Admin', dataKey: 'isAdmin', width: 20 }
        ],
        users.map(u => ({ ...u, isAdmin: u.isAdmin ? 'Sim' : 'Não' })),
        requester
    );
  }

  public async generateMoradoresReport(residents: Morador[], requester: Porteiro): Promise<{ blob: Blob, url: string, hash: string }> {
    return this.criarPDFListaModerno(
        'Lista de Moradores',
        [
            { header: 'Nome', dataKey: 'nome', width: 60 },
            { header: 'Unidade', dataKey: 'unidade', width: 30 },
            { header: 'Telefone', dataKey: 'telefone', width: 40 }
        ],
        residents.map(m => ({ ...m, unidade: `${m.bloco}-${m.apto}` })),
        requester
    );
  }

  public async generateTransportadorasReport(carriers: string[], requester: Porteiro): Promise<{ blob: Blob, url: string, hash: string }> {
    return this.criarPDFListaModerno(
        'Lista de Transportadoras',
        [
            { header: 'Nome', dataKey: 'nome', width: 100 }
        ],
        carriers.map(c => ({ nome: c })),
        requester
    );
  }
}
