import { Injectable } from '@angular/core';
declare var Tesseract: any;

/* ============================================================
   TYPES
============================================================ */

export type ScanStatus = 'valid' | 'invalid' | 'fallback';

export interface ScanResult {
  tracking: string;
  destinatario: string;
  transportadora: string;
  bloco: string;
  apartamento: string;
  confidence: number;
  heatmap: 'green' | 'yellow' | 'red';
  status: ScanStatus;
  timeMs: number;
}

/* ============================================================
   RESIDENT MEMORY (cache neural local)
============================================================ */

class ResidentMemory {

  private cache = new Map<string, string>();

  constructor() {
    const saved = localStorage.getItem('scanner_memory');
    if (saved) {
      JSON.parse(saved).forEach(([k, v]: any) =>
        this.cache.set(k, v)
      );
    }
  }

  remember(key: string, residentId: string) {
    this.cache.set(key, residentId);
    localStorage.setItem(
      'scanner_memory',
      JSON.stringify([...this.cache])
    );
  }

  recall(key: string) {
    return this.cache.get(key);
  }
}

/* ============================================================
   EXCLUSIVE SCANNER SERVICE — V3
============================================================ */

@Injectable({ providedIn: 'root' })
export class ExclusiveScannerService {

  private memory = new ResidentMemory();

  private readonly IGNORE = [
    'RUA','AV','CEP','BRASIL','PEDIDO','NOTA',
    'FISCAL','REMETENTE','EMAIL','TELEFONE'
  ];

  private readonly TRANSPORTADORAS = [
    'CORREIOS','JADLOG','LOGGI','MERCADO LIVRE',
    'SHOPEE','FEDEX','DHL','AZUL'
  ];

  private readonly TRACKING_PATTERNS = [
    /\b[A-Z]{2}\d{9}[A-Z]{2}\b/,
    /\b\d{15,22}\b/,
    /\b[A-Z0-9]{10,20}\b/
  ];

  private worker: any = null;
  private workerReady: Promise<void> | null = null;
  private inactivityTimeout: any = null;

  constructor() {
    // Não inicializa no construtor para economizar memória no boot
  }

  private initWorker() {
    if (!this.workerReady) {
      this.workerReady = (async () => {
        this.worker = await Tesseract.createWorker('por', 1);
        await this.worker.setParameters({
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1'
        });
      })();
    }
    this.resetInactivityTimeout();
    return this.workerReady;
  }

  private resetInactivityTimeout() {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
    }
    // Termina o worker após 15 segundos de inatividade para liberar memória (evita crash no carregador)
    this.inactivityTimeout = setTimeout(async () => {
      if (this.worker) {
        await this.worker.terminate();
        this.worker = null;
        this.workerReady = null;
      }
    }, 15000);
  }

  /* ---------------- OCR ---------------- */

  async runOCR(image: string): Promise<string> {
    await this.initWorker();

    const { data } = await this.worker.recognize(
      `data:image/jpeg;base64,${image}`
    );

    this.resetInactivityTimeout();
    return data.text.toUpperCase();
  }

  /* ---------------- Extractors ---------------- */

  private extractTracking(text: string) {
    for (const r of this.TRACKING_PATTERNS) {
      const m = text.match(r);
      if (m) return m[0];
    }
    return '';
  }

  private extractLocation(lines: string[]) {

    let bloco = '';
    let apartamento = '';

    for (const l of lines) {

      const b = l.match(/\b(BL|BLOCO)\s?([A-Z0-9]+)/);
      if (b) bloco = b[2];

      const a = l.match(/\b(AP|APT|APTO)\s?(\d{1,4})/);
      if (a) apartamento = a[2];
    }

    return { bloco, apartamento };
  }

  private extractCarrier(lines: string[]) {
    return lines.find(l =>
      this.TRANSPORTADORAS.some(t => l.includes(t))
    ) || '';
  }

  private extractName(lines: string[]) {
    return lines.find(l =>
      !/\d/.test(l) &&
      l.length > 5 &&
      !this.IGNORE.some(i => l.includes(i))
    ) || '';
  }

  /* ---------------- PROCESS ---------------- */

  async processScan(image: string): Promise<ScanResult> {

    const start = performance.now();

    const text = await this.runOCR(image);

    const lines = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 3);

    const tracking = this.extractTracking(text);
    const loc = this.extractLocation(lines);
    const transportadora = this.extractCarrier(lines);
    const destinatario = this.extractName(lines);

    let score = 0;

    if (loc.bloco) score += 40;
    if (loc.apartamento) score += 40;
    if (tracking) score += 10;
    if (destinatario) score += 10;

    return {
      tracking,
      destinatario,
      transportadora,
      bloco: loc.bloco,
      apartamento: loc.apartamento,
      confidence: score,
      status: score >= 80 ? 'valid' : 'fallback',
      heatmap:
        score >= 80 ? 'green' :
        score >= 50 ? 'yellow' : 'red',
      timeMs: performance.now() - start
    };
  }

  public filterBlacklist(text: string): string {
    return text;
  }

  public assistWithRegex(text: string): { destinatario?: string; transportadora?: string; rastreio?: string; bloco?: string; apto?: string } {
    return {};
  }
}
