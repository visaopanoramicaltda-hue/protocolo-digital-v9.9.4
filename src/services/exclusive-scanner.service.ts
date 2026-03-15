
import { Injectable } from '@angular/core';

declare var Tesseract: any;

export type ScanStatus = 'valid' | 'invalid' | 'fallback';

export type ScanResult = {
  destinatario: string;
  transportadora: string;
  confidence: number;
  heatmap: 'green' | 'yellow' | 'red';
  status: ScanStatus;
  timeMs: number;
  rawText?: string;
};

const STORAGE = {
  moradores: 'learned-moradores',
  transportadoras: 'learned-transportadoras',
  lastSync: 'dataset-last-sync'
};

const BASE_TRANSPORTADORAS = [
  'CORREIOS', 'SEDEX', 'JADLOG', 'LOGGI', 'TOTAL EXPRESS', 'AZUL CARGO', 
  'MERCADO LIVRE', 'AMAZON', 'SHOPEE', 'MAGALU', 'FEDEX', 'DHL', 'TNT',
  'BRASPRESS', 'PATRUS', 'DIRECT', 'SEQUOIA', 'RODONAVES'
];

// --- PROTOCOLO DE IMUNIDADE (BLACKLIST IMUTÁVEL) ---
const IMMUTABLE_IGNORE_LIST = [
    'RUA', 'AV.', 'AVENIDA', 'ALAMEDA', 'TRAVESSA', 'RODOVIA', 'ESTRADA', // Endereços
    'CEP', 'BAIRRO', 'CIDADE', 'ESTADO', 'UF', 'BRASIL', // Localização Genérica
    'PEDIDO', 'ORDER', 'NOTA', 'FISCAL', 'DANFE', 'CNPJ', 'CPF', 'INSCRICAO', // Documentos Fiscais
    'VOLUME', 'PESO', 'KG', 'GRAMAS', 'LITROS', // Metadados Físicos
    'SMS1', 'SMS2', 'SMS', // Lixo de Impressoras Térmicas
    'REMETENTE', 'DESTINATARIO', 'A/C', // Rótulos
    'SERIE', 'LOTE', 'VALIDADE', 'FABRICACAO', // Dados de Produto
    'FONE', 'TEL', 'CEL', 'CONTATO', // Contatos
    'WWW', 'HTTP', '.COM', '.BR', // URLs
    'FRAGIL', 'CUIDADO', 'VIDRO' // Avisos
];

@Injectable({
  providedIn: 'root'
})
export class ExclusiveScannerService {

  private readonly TIME_LIMIT = 1300; 
  
  // Yield de Resfriamento para Releitura (Motor Local é pesado)
  private readonly RELEITURA_THERMAL_YIELD_MS = 50; 
  
  // ROTA LOCAL (OFFLINE FIRST)
  private readonly WORKER_LOCAL = '/assets/tesseract/worker.min.js';
  private readonly CORE_LOCAL = '/assets/tesseract/tesseract-core.wasm.js';
  
  // CDN FALLBACK
  private readonly WORKER_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js';
  private readonly CORE_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js';
  
  constructor() {}

  /* ==========================
     OCR LOCAL (V4 ENGINE)
     ========================== */
  public async runOCR(image: Blob | string): Promise<string> {
    const source = typeof image === 'string' && !image.startsWith('data:') ? `data:image/jpeg;base64,${image}` : image;

    if (typeof Tesseract === 'undefined') {
        console.error('ExclusiveScanner: Tesseract.js global not loaded.');
        return ''; 
    }

    // 1. TENTATIVA LOCAL
    try {
        const worker = await Tesseract.createWorker('por', 1, {
          workerPath: this.WORKER_LOCAL,
          corePath: this.CORE_LOCAL,
          logger: () => {}, 
          errorHandler: () => {} 
        });
        
        // Parâmetros otimizados para texto misto (logística)
        await worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-./: ',
          tessedit_pageseg_mode: '6' // Assume bloco uniforme
        });

        const { data } = await worker.recognize(source);
        await worker.terminate();
        
        return data.text.toUpperCase();

    } catch (e: any) {
        if (!navigator.onLine) {
            console.warn('ExclusiveScanner: Offline e worker local falhou.');
            return ''; 
        }
        console.warn('ExclusiveScanner: Falha no Worker Local. Tentando CDN...', e);
        
        try {
            const workerCDN = await Tesseract.createWorker('por', 1, {
                workerPath: this.WORKER_CDN,
                corePath: this.CORE_CDN,
                errorHandler: () => {}
            });
            const { data } = await workerCDN.recognize(source);
            await workerCDN.terminate();
            return data.text.toUpperCase();
        } catch (cdnError) {
            console.error('ExclusiveScanner: Falha Fatal (Local + CDN).', cdnError);
            return '';
        }
    }
  }

  /* ==========================
     HISTÓRICO LOCAL (MEMORY)
     ========================== */
  private load(key: string): string[] {
    try {
        return JSON.parse(localStorage.getItem(key) || '[]');
    } catch { return []; }
  }

  private learn(key: string, value: string) {
    if (!value || value.length < 3) return;
    const list = this.load(key);
    if (!list.includes(value)) {
      list.push(value);
      localStorage.setItem(key, JSON.stringify(list));
    }
  }

  /* ==========================
     EXTRAÇÃO + CORREÇÃO (TITANIUM SHIELD)
     ========================== */
  private extract(text: string) {
    if (!text) return { destinatario: '', transportadora: '' };

    const rawLines = text.split('\n');
    const validLines: string[] = [];

    // --- FASE 1: FILTRAGEM AGRESSIVA (IMUNIDADE) ---
    for (const rawLine of rawLines) {
        const line = rawLine.trim().toUpperCase();
        if (line.length < 3) continue;

        // Se a linha contiver QUALQUER termo da Blacklist, ela morre aqui.
        const isToxic = IMMUTABLE_IGNORE_LIST.some(badTerm => line.includes(badTerm));
        if (!isToxic) {
            validLines.push(line);
        }
    }

    const learnedT = this.load(STORAGE.transportadoras);
    const allCarriers = [...BASE_TRANSPORTADORAS, ...learnedT];

    let destinatario = '';
    let transportadora = '';

    for (const l of validLines) {
      // 1. EXTRAÇÃO DE DESTINATÁRIO
      if (!destinatario) {
          // Heurística secundária: Linha isolada que sobreviveu à purga
          // Se não tem números (evita códigos) e é longa o suficiente
          if (l.length > 5 && l.length < 40 && !/\d/.test(l)) { 
             if (l.split(' ').length >= 2) {
                 destinatario = l;
             }
          }
      }

      // 2. EXTRAÇÃO DE TRANSPORTADORA
      if (!transportadora) {
          for (const t of allCarriers) {
            if (l.includes(t)) {
              transportadora = t;
              break;
            }
          }
      }
    }

    return { destinatario, transportadora };
  }

  /* ==========================
     SCORE + HEATMAP
     ========================== */
  private confidence(data: { destinatario: string; transportadora: string }) {
    let c = 0;
    if (data.destinatario.length >= 6) c += 40;
    if (data.transportadora) c += 40;
    
    const learnedResidents = this.load(STORAGE.moradores);
    if (learnedResidents.some(r => data.destinatario.includes(r) || r.includes(data.destinatario))) c += 20;
    
    return Math.min(c, 100);
  }

  private heatmap(score: number): 'green' | 'yellow' | 'red' {
    if (score >= 75) return 'green';
    if (score >= 40) return 'yellow';
    return 'red';
  }

  /* ==========================
     ENGINE PRINCIPAL
     ========================== */
  async processScan(image: Blob | string): Promise<ScanResult> {
    // --- PROTOCOLO DE RESFRIAMENTO PARA RELEITURA ---
    // Pausa tática de 200ms antes de iniciar o Tesseract.
    // Isso permite que o device dissipe o calor gerado pela câmera antes de
    // iniciar o pico de CPU do OCR local.
    await new Promise(resolve => setTimeout(resolve, this.RELEITURA_THERMAL_YIELD_MS));

    const start = performance.now();

    try {
      const text = await Promise.race([
        this.runOCR(image),
        new Promise<string>((resolve) => setTimeout(() => resolve('TIMEOUT'), this.TIME_LIMIT))
      ]);

      if (text === 'TIMEOUT' || !text) {
          if (text === 'TIMEOUT') console.warn('[ExclusiveScanner] Tempo limite de leitura excedido.');
          
          return {
              destinatario: '', transportadora: '', confidence: 0,
              heatmap: 'red', status: 'invalid', timeMs: performance.now() - start,
              rawText: ''
          };
      }

      const extracted = this.extract(text);
      const score = this.confidence(extracted);
      const heatmap = this.heatmap(score);

      if (score >= 90) {
        this.learn(STORAGE.moradores, extracted.destinatario);
        this.learn(STORAGE.transportadoras, extracted.transportadora);
      }

      return {
        ...extracted,
        confidence: score,
        heatmap,
        status: score >= 75 ? 'valid' : score >= 40 ? 'fallback' : 'invalid',
        timeMs: performance.now() - start,
        rawText: text
      };

    } catch (e) {
      console.error('[ExclusiveScanner] Falha no processamento:', e);
      return {
          destinatario: '', transportadora: '', confidence: 0, 
          heatmap: 'red', status: 'invalid', timeMs: performance.now() - start,
          rawText: ''
      };
    }
  }
}
