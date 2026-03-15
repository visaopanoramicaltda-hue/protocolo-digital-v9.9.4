
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DbService, Morador, Encomenda } from '../services/db.service';
import { UiService } from './ui.service';
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { QuantumNetService } from './core/quantum-net.service';
import { DeepSeekService } from './deep-seek.service';
import { environment } from '../environments/environment';

declare var jsQR: any;

export interface NeuralEvent {
  timestamp: number;
  type: 'CORRECTION' | 'CONFIRMATION';
  ocrRead: string;
  userCorrection: string;
  field: 'DESTINATARIO' | 'BLOCO' | 'APTO' | 'TRANSPORTADORA' | 'RASTREIO' | 'CONDICAO_FISICA';
}

export interface ImageQualityData {
    isBlurry: boolean;
    isEmpty: boolean;
    textDensity: number;
    isPerfect: boolean;
    hasQr: boolean;
}

export interface OcrExtractionResult {
  destinatario: string;
  localizacao: string; 
  transportadora: string;
  confianca: number;
  rawRastreio?: string;
  isBlurry?: boolean;
  isEmpty?: boolean;
  textDensity?: number;
  isTurbo?: boolean; 
  condicaoVisual?: string;
  destinatarioConfidence?: number;
  localizacaoConfidence?: number;
  transportadoraConfidence?: number;
  rastreioConfidence?: number;
  privacyBlocked?: boolean; 
  // Identificação Lógica
  matchedMoradorId?: string; // ID do morador encontrado via lógica
  wasAutoCorrected?: boolean; // Flag se houve correção automática
}

interface OcrCacheEntry {
  data: OcrExtractionResult & { ocrRawText?: string };
  timestamp: number;
}

export interface SimbioseMemory {
  carrierFrequency: Record<string, number>;
  residentFrequency: Record<string, number>; 
  // NOVA MEMÓRIA: Mapa de Erros Comuns -> ID Real (Ex: "Sanny Setora" -> "uuid-sanny")
  residentAliases: Record<string, string>; 
  lastTraining: number;
  neuralVersion?: number; 
}

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private db = inject(DbService);
  private ui = inject(UiService);
  private http = inject(HttpClient);
  private quantumNet = inject(QuantumNetService); 
  private deepSeek = inject(DeepSeekService); 
  
  private genAI: GoogleGenAI;
  private apiKey: string = '';
  
  public evolutionStatus = signal<'IDLE' | 'ANALYZING' | 'EVOLVING' | 'COMPLETE' | 'OPTIMIZING'>('IDLE');
  public lastEvolution = signal<string>('');
  public geminiApiStatus = signal<'NOT_CONFIGURED' | 'CONFIGURED' | 'CALL_FAILED' | 'OFFLINE'>('NOT_CONFIGURED');

  private readonly CACHE_KEY = 'simbiose_ocr_cache';
  private readonly MEMORY_KEY = 'simbiose_deep_memory';
  private readonly CACHE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
  private readonly SCAN_COUNT_KEY = 'simbiose_valid_scans_count';
  
  private ocrCache: Map<string, OcrCacheEntry> = new Map();
  private memory: SimbioseMemory = { carrierFrequency: {}, residentFrequency: {}, residentAliases: {}, lastTraining: 0, neuralVersion: 1 };

  constructor() {
    this.genAI = { models: {} } as any;
    this.initializeConfig();
    
    this.loadOcrCache();
    this.loadMemory();
    
    setTimeout(() => {
        const isStale = (Date.now() - this.memory.lastTraining) > (24 * 60 * 60 * 1000);
        if (isStale) {
            this.retrainSimbioseFromDatabase();
        }
    }, 5000);
    
    this.quantumNet.memoriaRecebida.subscribe(memoriaExterna => {
        if (memoriaExterna) {
            this.fundirMemoria(memoriaExterna);
        }
    });
  }

  private async initializeConfig() {
    try {
      // Busca a chave que o servidor disponibilizou
      const config: any = await firstValueFrom(this.http.get('/api/config'));
      if (config.geminiApiKey) {
        this.apiKey = config.geminiApiKey;
        this.genAI = new GoogleGenAI({ apiKey: this.apiKey });
        this.geminiApiStatus.set('CONFIGURED');
        console.log('🟠 Simbiose: Gemini API configurada com sucesso.');
      }
    } catch (err) {
      // Fallback para configuração local (development)
      const fallbackKey = environment.geminiApiKey || '';
      if (fallbackKey) {
        this.apiKey = fallbackKey;
        this.genAI = new GoogleGenAI({ apiKey: this.apiKey });
        this.geminiApiStatus.set('CONFIGURED');
        console.log('🟠 Simbiose: Gemini API configurada via environment local.');
      } else {
        this.geminiApiStatus.set('NOT_CONFIGURED');
        console.error('🔴 Simbiose: Erro ao carregar chave da API', err);
      }
    }
  }
  
  public getMemory(): Readonly<SimbioseMemory> {
      return this.memory;
  }
  
  public calculateNeuralWeight(): number {
      const carriers = Object.keys(this.memory.carrierFrequency).length;
      const residents = Object.keys(this.memory.residentFrequency).length;
      const aliases = Object.keys(this.memory.residentAliases || {}).length;
      const trainingBonus = Math.floor((this.memory.lastTraining / (1000 * 60 * 60 * 24)) % 100); 
      return (carriers * 5) + (residents * 2) + (aliases * 10) + trainingBonus;
  }

  // --- LOGIC ENGINE: APRENDIZADO DE ALIAS ---
  public learnFromPackage(encomenda: Encomenda, originalOcrName?: string) {
    if (!encomenda) return;
    
    let memoryUpdated = false;
    const transp = encomenda.transportadora;
    
    // Aprendizado de Transportadora
    if (transp && transp !== 'LEITURA MANUAL' && transp !== 'N/A') {
       this.memory.carrierFrequency[transp] = (this.memory.carrierFrequency[transp] || 0) + 1;
       memoryUpdated = true;
    }
    
    // Aprendizado de Frequência de Morador
    if (encomenda.destinatarioNome && encomenda.bloco && encomenda.apto) {
       const resKey = `${encomenda.destinatarioNome}|${encomenda.bloco}|${encomenda.apto}`;
       this.memory.residentFrequency[resKey] = (this.memory.residentFrequency[resKey] || 0) + 1;
       memoryUpdated = true;
    }

    // --- LÓGICA DE ALIAS (CORREÇÃO DE NOME) ---
    // Se o OCR leu algo diferente do que foi salvo, aprendemos essa variação.
    if (originalOcrName && encomenda.destinatarioNome) {
        const ocrClean = this.normalizeString(originalOcrName);
        const finalClean = this.normalizeString(encomenda.destinatarioNome);
        
        // Se são diferentes mas não vazios
        if (ocrClean && finalClean && ocrClean !== finalClean) {
            // Verifica se encontramos o morador no banco para pegar o ID real
            const moradorReal = this.db.moradores().find(m => 
                this.normalizeString(m.nome) === finalClean &&
                this.normalizeString(m.bloco) === this.normalizeString(encomenda.bloco) &&
                this.normalizeString(m.apto) === this.normalizeString(encomenda.apto)
            );

            if (moradorReal) {
                // Mapeia "SANNY SETORA" -> "ID_DO_MORADOR_SANNY"
                if (!this.memory.residentAliases) this.memory.residentAliases = {};
                this.memory.residentAliases[ocrClean] = moradorReal.id;
                memoryUpdated = true;
                console.log(`[Neural Logic] Alias Aprendido: "${ocrClean}" => ${moradorReal.nome}`);
            }
        }
    }

    if (memoryUpdated) {
        this.memory.lastTraining = Date.now();
        this.saveMemory();
        setTimeout(() => this.deepSeek.executarTreinamentoDiario().catch(() => {}), 1000);
    }
  }
  
  public async registrarLeituraValida() {
      let count = parseInt(localStorage.getItem(this.SCAN_COUNT_KEY) || '0') + 1;
      localStorage.setItem(this.SCAN_COUNT_KEY, count.toString());
      if (count % 10 === 0) {
          const countCarriers = this.db.forceTrainingDataset(); 
          await this.retrainSimbioseFromDatabase(); 
          this.ui.show(`Simbiose Evoluiu: ${countCarriers} padrões atualizados.`, 'SUCCESS');
      }
  }

  // --- HYBRID OCR ENGINE + LOGIC RESOLVER ---
  
  async extractTextFromLabel(
      imageBase64: string, 
      moradores: Morador[], 
      carriers: string[], 
      localHints: { qrCode?: string, ocrText?: string, qualityData?: ImageQualityData } = {}
  ): Promise<OcrExtractionResult> {

    if (!imageBase64 || imageBase64.length < 100) return this.emptyResult();
    
    const cacheKey = localHints.qrCode || await this.db.getUniqueHash(imageBase64); 
    const cached = this.getOcrCacheEntry(cacheKey);
    if (cached) return cached.data;

    // 1. EXTRAÇÃO PURA (OCR)
    let rawResult: OcrExtractionResult;
    const hasKey = this.geminiApiStatus() === 'CONFIGURED';
    const isOnline = navigator.onLine && hasKey;

    let qualityResult = localHints.qualityData || await this.detectImageQuality(imageBase64);
    let turboActive = qualityResult.isPerfect;

    if (!isOnline) {
        // Offline Mode
        try {
            rawResult = await this.deepSeek.processarImagemOffline(imageBase64, localHints);
        } catch (e) {
            rawResult = this.emptyResult();
        }
    } else {
        // Online Mode
        try {
            const topCarriers = this.getTopLearnedCarriers();
            const activeCarriers = [...new Set([...topCarriers, ...carriers])];
            rawResult = await this.runCloudGemini(imageBase64, moradores, activeCarriers, localHints);
        } catch (err) {
            // FALLBACK PARA RELEITURA OFFLINE
            // Thermal Yield: Pausa antes de iniciar o Tesseract para evitar superaquecimento
            await new Promise(resolve => setTimeout(resolve, 100));
            rawResult = await this.deepSeek.processarImagemOffline(imageBase64, localHints);
        }
    }

    // 2. LÓGICA DE RESOLUÇÃO DE IDENTIDADE (SNIPER MODE STRICT)
    const refinedResult = this.resolveIdentityLogic(rawResult, moradores);

    // Salva no cache
    if (refinedResult.confianca > 0.6) {
        this.setOcrCacheEntry(cacheKey, { 
            data: { ...refinedResult, isTurbo: turboActive }, 
            timestamp: Date.now() 
        });
    }
    
    return { ...refinedResult, isBlurry: qualityResult.isBlurry, isEmpty: qualityResult.isEmpty, isTurbo: turboActive };
  }

  // --- CORE LOGIC: TRIANGULAÇÃO SNIPER STRICT ---
  private resolveIdentityLogic(raw: OcrExtractionResult, moradores: Morador[]): OcrExtractionResult {
      let finalResult = { ...raw };
      
      // Normalização inicial
      const rawName = this.normalizeString(raw.destinatario);
      
      // 1. TENTATIVA POR ALIAS (MEMÓRIA OCULTA)
      // Verifica se esse nome "errado" já foi mapeado antes (Ex: Setora -> Sefora)
      if (this.memory.residentAliases && this.memory.residentAliases[rawName]) {
          const residentId = this.memory.residentAliases[rawName];
          const resident = moradores.find(m => m.id === residentId);
          if (resident) {
              console.log('[Logic] Alias Detectado! Autopreenchendo:', resident.nome);
              finalResult.destinatario = resident.nome;
              finalResult.matchedMoradorId = resident.id;
              finalResult.wasAutoCorrected = true;
              return finalResult;
          }
      }

      // 2. TRIANGULAÇÃO DE BLOCO/APTO COM GUARD RAIL EXTREMO (MODO SNIPER)
      const locationData = this.parseLocationString(raw.localizacao) || this.parseLocationString(raw.destinatario);
      
      if (locationData) {
          const { bloco, apto } = locationData;
          
          const moradoresDaUnidade = moradores.filter(m => 
              this.normalizeString(m.bloco) === bloco && 
              this.normalizeString(m.apto) === apto
          );

          if (moradoresDaUnidade.length > 0) {
              let bestMatch = null;
              let bestScore = 0;

              for (const morador of moradoresDaUnidade) {
                  const score = this.calculateSimilarity(rawName, this.normalizeString(morador.nome));
                  if (score > bestScore) {
                      bestScore = score;
                      bestMatch = morador;
                  }
              }

              // SNIPER RULE STRICT: 
              // Aumentado threshold para 0.85 (85% de similaridade).
              // Isso impede que "MARIA" seja trocado por "JOAO" só porque moram juntos.
              // Apenas erros de OCR (ex: J0AO -> JOAO) passarão.
              if (bestMatch && bestScore > 0.85) {
                  console.log('[Logic] Triangulação Perfeita:', bestMatch.nome);
                  finalResult.destinatario = bestMatch.nome;
                  finalResult.matchedMoradorId = bestMatch.id;
                  finalResult.wasAutoCorrected = true;
                  return finalResult;
              } else {
                  // Se não bateu o nome, MANTÉM O OCR ORIGINAL.
                  // Nunca adivinhe que é o titular se o nome for diferente.
                  console.log('[Logic] Unidade detectada, mas nome distinto. Mantendo original fiel.');
                  // Preenchemos apenas a unidade para ajudar, mas deixamos o nome intacto.
                  // Nota: O Form Component já preenche bloco/apto se vier vazio no OCR mas tiver match aqui?
                  // O parseLocationString já extraiu o bloco/apto do texto, então o form já deve ter recebido no rawResult.
              }
          }
      }

      // 3. TENTATIVA FUZZY GLOBAL (Último recurso, muito cauteloso)
      if (rawName.length > 5) {
          let bestGlobalMatch = null;
          let bestGlobalScore = 0;

          for (const morador of moradores) {
              const score = this.calculateSimilarity(rawName, this.normalizeString(morador.nome));
              if (score > bestGlobalScore) {
                  bestGlobalScore = score;
                  bestGlobalMatch = morador;
              }
          }

          // SNIPER RULE GLOBAL: Exige 95% de certeza para trocar sem unidade.
          if (bestGlobalMatch && bestGlobalScore > 0.95) { 
               console.log('[Logic] Match Fuzzy Global (Certeza Absoluta):', bestGlobalMatch.nome);
               finalResult.destinatario = bestGlobalMatch.nome;
               finalResult.matchedMoradorId = bestGlobalMatch.id;
               finalResult.wasAutoCorrected = true;
          }
      }

      return finalResult;
  }

  // Helpers de Lógica
  private normalizeString(str: string | undefined | null): string {
    return (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
  }

  private parseLocationString(text: string): { bloco: string, apto: string } | null {
      if (!text) return null;
      const clean = this.normalizeString(text);
      
      const regexComplex = /BL.*?([A-Z0-9]+).*?AP.*?([0-9]+)/;
      const match = clean.match(regexComplex);
      if (match) return { bloco: match[1], apto: match[2] };
      
      const simpleParts = clean.split(' ');
      if (simpleParts.length >= 2 && !isNaN(parseInt(simpleParts[simpleParts.length-1]))) {
          // Assume último token numérico como apto se houver contexto
      }
      
      return null;
  }

  private calculateSimilarity(s1: string, s2: string): number {
      const longer = s1.length > s2.length ? s1 : s2;
      const shorter = s1.length > s2.length ? s2 : s1;
      if (longer.length === 0) return 1.0;
      return (longer.length - this.editDistance(longer, shorter)) / longer.length;
  }

  private editDistance(s1: string, s2: string): number {
      const costs = new Array();
      for (let i = 0; i <= s1.length; i++) {
          let lastValue = i;
          for (let j = 0; j <= s2.length; j++) {
              if (i === 0) costs[j] = j;
              else {
                  if (j > 0) {
                      let newValue = costs[j - 1];
                      if (s1.charAt(i - 1) !== s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                      costs[j - 1] = lastValue;
                      lastValue = newValue;
                  }
              }
          }
          if (i > 0) costs[s2.length] = lastValue;
      }
      return costs[s2.length];
  }

  // --- HELPERS (QR, Image Quality, Cloud) Mantidos para suporte ao Online Mode ---

  public quickImageQualityCheck(imageData: ImageData): ImageQualityData {
    const data = imageData.data; const width = imageData.width; const height = imageData.height; const stride = 16; 
    let totalBrightness = 0; let pixelCount = 0; let edgeSum = 0; let prevGray = -1;
    for (let y = 0; y < height; y += stride) {
        for (let x = 0; x < width; x += stride) {
            const i = (y * width + x) * 4;
            const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
            totalBrightness += gray; pixelCount++;
            if (prevGray !== -1) edgeSum += Math.abs(gray - prevGray);
            prevGray = gray;
        }
    }
    const avgBrightness = pixelCount > 0 ? totalBrightness / pixelCount : 0;
    const avgEdge = pixelCount > 0 ? edgeSum / pixelCount : 0;
    const isBlurry = avgEdge < 2.0; 
    const isEmpty = avgBrightness < 20 || avgBrightness > 250;
    const isPerfect = avgEdge > 5.5 && avgBrightness > 80 && avgBrightness < 220;
    return { isBlurry, isEmpty, textDensity: avgEdge, isPerfect, hasQr: false };
  }

  private async detectImageQuality(base64: string): Promise<ImageQualityData> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 100; canvas.height = (img.height / img.width) * 100;
            ctx!.drawImage(img, 0, 0, canvas.width, canvas.height);
            const data = ctx!.getImageData(0, 0, canvas.width, canvas.height);
            resolve(this.quickImageQualityCheck(data));
        };
        img.onerror = () => resolve({ isBlurry: false, isEmpty: false, textDensity: 0.5, isPerfect: false, hasQr: false });
        img.src = 'data:image/jpeg;base64,' + base64;
    });
  }

  private async runCloudGemini(base64: string, moradores: Morador[], carriers: string[], localHints: { qrCode?: string }): Promise<OcrExtractionResult> {
      const carrierList = carriers.slice(0, 50).join(',');
      
      // SNIPER MODE PROMPT REFORÇADO (VERBATIM)
      const systemInstruction = `
        JSON ONLY. Extract: destinatario, transportadora, rastro. Condição: Intacta/Violada.
        List: [${carrierList}]. QR: ${localHints.qrCode || 'N/A'}. 
        
        SNIPER PROTOCOL ACTIVATED (STRICT VERBATIM):
        - EXTRACT TEXT EXACTLY AS PRINTED. DO NOT AUTO-CORRECT.
        - DO NOT GUESS NAMES. If the label says "Maria", WRITE "Maria", even if you think it should be "Mario".
        - If the name is blurry/illegible, return EMPTY STRING. DO NOT HALLUCINATE.
        - IGNORE ADDRESS LINES (Rua, Av, CEP). Focus ONLY on RECIPIENT NAME.
        
        PRIVACY PROTOCOL ZERO:
        - YOU MUST NOT PROCESS HUMAN FACES. If a human face is clearly visible, set 'privacyBlocked' to true.
        
        IMMUTABLE RULES:
        1. BLACKLIST: IGNORE 'RUA', 'AV', 'CEP', 'PEDIDO', 'NOTA', 'FISCAL', 'CNPJ', 'CPF', 'VOLUME'.
        2. TRACKING: Must be long alphanumeric.
        3. CARRIER: Look for logos or names from the provided list.
      `;
      const prompt = `Analise a etiqueta fielmente. Sem suposições.`;

      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: { 
            destinatario: { type: Type.STRING },
            localizacao: { type: Type.STRING },
            transportadora: { type: Type.STRING },
            rawRastreio: { type: Type.STRING },
            condicaoVisual: { type: Type.STRING, enum: ["Intacta", "Amassada", "Rasgada", "Violada"] },
            confianca: { type: Type.NUMBER },
            privacyBlocked: { type: Type.BOOLEAN, description: "True if human face is detected." }
        },
        required: ["destinatario", "transportadora", "confianca"]
      };

      if (!this.apiKey) throw new Error("No API Key");

      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash', 
        contents: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: base64 } }, { text: prompt }] },
        config: { systemInstruction, responseMimeType: 'application/json', responseSchema, temperature: 0.0, thinkingConfig: { thinkingBudget: 0 } }
      });
      
      const parsed = JSON.parse(response.text || '{}');
      return {
          destinatario: parsed.destinatario || '',
          localizacao: parsed.localizacao || '',
          transportadora: parsed.transportadora || 'LEITURA MANUAL',
          confianca: parsed.confianca || 0.0,
          rawRastreio: parsed.rawRastreio,
          condicaoVisual: parsed.condicaoVisual || 'Intacta',
          destinatarioConfidence: parsed.destinatario ? (parsed.confianca || 0.8) : 0,
          localizacaoConfidence: parsed.localizacao ? (parsed.confianca || 0.8) : 0,
          transportadoraConfidence: parsed.transportadora ? 0.8 : 0,
          rastreioConfidence: parsed.rawRastreio ? 0.9 : 0,
          privacyBlocked: parsed.privacyBlocked || false 
      };
  }

  public async retrainSimbioseFromDatabase(): Promise<void> {
      return this.deepSeek.executarTreinamentoDiario().then(memory => {
          this.fundirMemoria(memory);
      });
  }

  private loadMemory() {
      try { const stored = localStorage.getItem(this.MEMORY_KEY); if (stored) this.memory = JSON.parse(stored); } catch (e) {}
  }
  private saveMemory() {
      try { localStorage.setItem(this.MEMORY_KEY, JSON.stringify(this.memory)); } catch (e) {}
  }
  public exportarMemoria(): string { return JSON.stringify(this.memory, null, 2); }
  public importarMemoria(json: string): boolean {
    try { return this.fundirMemoria(JSON.parse(json)); } catch (e) { return false; }
  }
  
  private fundirMemoria(memoriaExterna: SimbioseMemory): boolean {
    if (!memoriaExterna.carrierFrequency) return false;
    Object.entries(memoriaExterna.carrierFrequency).forEach(([k, v]) => {
        this.memory.carrierFrequency[k] = Math.max(this.memory.carrierFrequency[k] || 0, v);
    });
    // Fundir Aliases (Lógica simples: sobrescreve se novo tiver mais)
    if (memoriaExterna.residentAliases) {
        this.memory.residentAliases = { ...this.memory.residentAliases, ...memoriaExterna.residentAliases };
    }
    this.memory.neuralVersion = Math.max(this.memory.neuralVersion || 1, memoriaExterna.neuralVersion || 1);
    this.saveMemory();
    this.lastEvolution.set(new Date().toLocaleTimeString());
    return true;
  }

  private getTopLearnedCarriers(): string[] {
      return Object.entries(this.memory.carrierFrequency).sort(([,a], [,b]) => b - a).slice(0, 15).map(([k]) => k);
  }

  private emptyResult() { return { destinatario: '', localizacao: '', transportadora: 'LEITURA MANUAL', confianca: 0 }; }
  
  private loadOcrCache() {
    try {
      const stored = localStorage.getItem(this.CACHE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const freshEntries = parsed.filter(([_, entry]) => (Date.now() - entry.timestamp) < this.CACHE_LIFETIME_MS);
          this.ocrCache = new Map(freshEntries);
        }
      }
    } catch (e) { localStorage.removeItem(this.CACHE_KEY); }
  }
  private saveOcrCache() { try { localStorage.setItem(this.CACHE_KEY, JSON.stringify(Array.from(this.ocrCache.entries()))); } catch (e) {} }
  private getOcrCacheEntry(key: string): OcrCacheEntry | undefined {
    let entry = this.ocrCache.get(key);
    if (entry && (Date.now() - entry.timestamp < this.CACHE_LIFETIME_MS)) return entry;
    this.ocrCache.delete(key); return undefined;
  }
  private setOcrCacheEntry(key: string, entry: OcrCacheEntry): void {
    if (this.ocrCache.size >= 200 && !this.ocrCache.has(key)) {
      const lruKey = this.ocrCache.keys().next().value;
      this.ocrCache.delete(lruKey);
    }
    this.ocrCache.set(key, entry);
    this.saveOcrCache();
  }
  public clearOcrCache(): void { this.ocrCache.clear(); this.saveOcrCache(); }
}
