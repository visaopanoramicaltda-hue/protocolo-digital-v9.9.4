
import { Injectable, inject, signal } from '@angular/core';
import { DbService, Morador, Encomenda } from '../services/db.service';
import { UiService } from './ui.service';
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { QuantumNetService } from './core/quantum-net.service';
import { ExclusiveScannerService } from './exclusive-scanner.service';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare let jsQR: unknown;

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
  possibleMoradores?: Morador[]; // Lista de moradores possíveis para seleção manual
  bloco?: string; // Bloco extraído
  apto?: string; // Apto extraído
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
  private quantumNet = inject(QuantumNetService); 
  private scannerV4 = inject(ExclusiveScannerService);
  
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
    const apiKey = process.env.GEMINI_API_KEY || '';
    this.apiKey = apiKey;

    try {
      this.genAI = new GoogleGenAI({ apiKey: apiKey });
      if (this.apiKey) {
        this.geminiApiStatus.set('CONFIGURED');
      } else {
        this.geminiApiStatus.set('NOT_CONFIGURED');
      }
    } catch {
      this.genAI = { models: {} } as unknown as GoogleGenAI;
      this.geminiApiStatus.set('NOT_CONFIGURED');
    }
    
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
    }
  }
  
  public registrarLeituraValida(): void {
      const count = parseInt(localStorage.getItem(this.SCAN_COUNT_KEY) || '0', 10) + 1;
      localStorage.setItem(this.SCAN_COUNT_KEY, count.toString());
      if (count % 10 === 0) {
          this.db.forceTrainingDataset(); 
          this.retrainSimbioseFromDatabase(); 
          this.ui.show(`Simbiose Evoluiu: ${count} padrões atualizados.`, 'SUCCESS');
      }
  }

  // --- HYBRID OCR ENGINE + LOGIC RESOLVER ---
  
  public async enviarParaAnalise(contexto: string): Promise<OcrExtractionResult> {
      const prompt = `
        A partir de agora, o processamento de imagem/OCR bruto é realizado localmente via Google ML Kit.
        Entrada de Dados: Você receberá strings de texto pré-processadas.
        Missão: Sua função é exclusivamente a análise lógica, categorização e validação dos dados recebidos.
        Modo Econômico: Responda de forma concisa (JSON) para minimizar o uso de tokens de saída.
        Foco: Logística, conferência de etiquetas e protocolos de segurança.
        
        CAMPOS:
        1. destinatario: Nome completo.
        2. bloco: Bloco/Torre.
        3. apto: Unidade.
        4. transportadora: Identifique a transportadora (SHOPEE, MERCADO LIVRE, AMAZON, CORREIOS, LOGGI, JADLOG, etc.).
        5. rawRastreio: Código de rastreio.
        
        REGRAS DE VALIDAÇÃO (CRÍTICO):
        - EXTRAÇÃO ESTRITA DE NOME: Extraia o nome EXATAMENTE como aparece no texto. NUNCA tente adivinhar, corrigir, autocompletar ou "alinhar" o nome. Se o nome estiver incompleto ou estranho, retorne exatamente o que leu.
        - A transportadora deve ser identificada PRIMEIRO.
        - Com base na transportadora, valide o formato do código de rastreio:
          - CORREIOS: 2 letras + 9 números + 2 letras (ex: AA123456789BR).
          - SHOPEE (SPX): Geralmente começa com BR seguido de números.
          - MERCADO LIVRE: Numérico.
          - AMAZON: Começa com TBA.
        - O texto "VESNINATARIO" ou similares (ex: "DESTINATARIO") NUNCA é um código de rastreio. Ignore-os.
        - Se o código de rastreio não corresponder ao padrão da transportadora detectada, NÃO invente um código. Deixe vazio.
        - NÃO adivinhe NENHUM dado. Se não tiver certeza absoluta, deixe o campo vazio.
        
        TEXTO:
        "${contexto}"
      `;
      
      const responseSchema: Schema = {
        type: Type.OBJECT,
        properties: { 
            destinatario: { type: Type.STRING },
            bloco: { type: Type.STRING },
            apto: { type: Type.STRING },
            transportadora: { type: Type.STRING },
            rawRastreio: { type: Type.STRING },
            confianca: { type: Type.NUMBER },
        },
        required: ["destinatario", "transportadora", "confianca"]
      };

      try {
          if (!this.apiKey) throw new Error("No Gemini API Key");

          const response = await this.genAI.models.generateContent({
            model: 'gemini-3.1-flash-lite-preview',
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: responseSchema,
              temperature: 0.1
            }
          });
          
          const parsed = JSON.parse(response.text || '{}');
          return {
              destinatario: parsed.destinatario || '',
              bloco: parsed.bloco || '',
              apto: parsed.apto || '',
              localizacao: (parsed.bloco && parsed.apto) ? `${parsed.bloco} ${parsed.apto}` : '',
              transportadora: parsed.transportadora || 'LEITURA MANUAL',
              confianca: parsed.confianca || 0.0,
              rawRastreio: parsed.rawRastreio,
              condicaoVisual: 'Intacta',
          };
      } catch (geminiError) {
          console.error('Gemini falhou em enviarParaAnalise.', geminiError);
          throw geminiError;
      }
  }

  async extractTextFromLabel(
      imageBase64: string, 
      moradores: Morador[], 
      carriers: string[], 
      localHints: { qrCode?: string, ocrText?: string, qualityData?: ImageQualityData } = {}
  ): Promise<OcrExtractionResult> {
    
    const startTime = performance.now();
    // console.log('[SIMBIOSE] Iniciando Protocolo de Leitura Híbrida (Turbo Mode)...');

    if (!imageBase64 || imageBase64.length < 100) return this.emptyResult();
    
    const cacheKey = localHints.qrCode || await this.db.getUniqueHash(imageBase64); 
    const cached = this.getOcrCacheEntry(cacheKey);
    if (cached) {
        const endTime = performance.now();
        console.log(`[SIMBIOSE] OCR + Gemini Flash Lite (Cache) executado em ${((endTime - startTime) / 1000).toFixed(2)}s`);
        return cached.data;
    }

    // 1. EXTRAÇÃO PURA (OCR TESSERACT LATEST)
    let rawResult: OcrExtractionResult;
    
    const qualityResult = localHints.qualityData || await this.detectImageQuality(imageBase64);
    const turboActive = qualityResult.isPerfect;

    try {
        // [OCR LOCAL] Usa o texto pré-processado se fornecido, senão usa o Tesseract
        const rawText = localHints.ocrText || await this.scannerV4.runOCR(imageBase64);
        
        // [PROTOCOLO DE IMUNIDADE] Filtra informações indesejadas (Blacklist)
        const filteredText = this.scannerV4.filterBlacklist(rawText);
        
        // [REGEX DE ÚLTIMA GERAÇÃO] Auxilia na extração preliminar
        const regexHints = this.scannerV4.assistWithRegex(rawText);
        
        if (filteredText && filteredText.length > 5) {
            // [GEMINI VEREDITO] Envia o texto filtrado + dicas de regex para análise lógica
            const promptContext = `
              Texto Filtrado (OCR): "${filteredText}"
              Dicas de Regex: ${JSON.stringify(regexHints)}
              QR Code/Lens: ${localHints.qrCode || 'Não detectado'}
            `;
            
            rawResult = await this.enviarParaAnalise(promptContext);
            
            // [GOOGLE LENS / QR CODE] Prioriza o código de rastreio lido via scanner de código
            if (localHints.qrCode) {
                rawResult.rawRastreio = localHints.qrCode;
            } else if (!rawResult.rawRastreio && regexHints.rastreio) {
                rawResult.rawRastreio = regexHints.rastreio;
            }
        } else {
            // Fallback para o parser local se o texto for muito curto
            const scanResult = await this.scannerV4.processScan(imageBase64);
            rawResult = {
                destinatario: scanResult.destinatario,
                transportadora: scanResult.transportadora,
                rawRastreio: localHints.qrCode || regexHints.rastreio,
                confianca: scanResult.confidence / 100,
                localizacao: regexHints.bloco && regexHints.apto ? `${regexHints.bloco} ${regexHints.apto}` : '',
                condicaoVisual: 'Intacta'
            };
        }
    } catch {
        rawResult = this.emptyResult();
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
    
    const endTime = performance.now();
    console.log(`[SIMBIOSE] OCR + Gemini Flash Lite executado em ${((endTime - startTime) / 1000).toFixed(2)}s`);

    return { ...refinedResult, isBlurry: qualityResult.isBlurry, isEmpty: qualityResult.isEmpty, isTurbo: turboActive };
  }

  public runAccuracyTest(): void {
    const moradores: Morador[] = [
      { id: '1', nome: 'JOAO SILVA', bloco: 'A', apto: '101' },
      { id: '2', nome: 'MARIA SOUZA', bloco: 'A', apto: '101' },
      { id: '3', nome: 'PEDRO SANTOS', bloco: 'B', apto: '202' }
    ];

    const scenarios = [
      { raw: { destinatario: 'JOAO SILVA', localizacao: 'BL A AP 101', transportadora: 'CORREIOS', confianca: 1.0 }, expected: 'JOAO SILVA' },
      { raw: { destinatario: 'J0AO SILVA', localizacao: 'BL A AP 101', transportadora: 'CORREIOS', confianca: 0.9 }, expected: 'JOAO SILVA' },
      { raw: { destinatario: 'MARIA', localizacao: 'BL A AP 101', transportadora: 'CORREIOS', confianca: 0.8 }, expected: 'MARIA SOUZA' },
      { raw: { destinatario: 'PEDRO', localizacao: 'BL B AP 202', transportadora: 'CORREIOS', confianca: 0.9 }, expected: 'PEDRO SANTOS' },
      { raw: { destinatario: 'JOAO SILVA', localizacao: 'BL B AP 202', transportadora: 'CORREIOS', confianca: 0.9 }, expected: 'JOAO SILVA' } // Should not match
    ];

    console.log('[AccuracyTest] Iniciando...');
    scenarios.forEach((s, i) => {
      const result = this.resolveIdentityLogic(s.raw, moradores);
      const passed = result.destinatario === s.expected;
      console.log(`[AccuracyTest] ${i+1}: ${passed ? 'PASS' : 'FAIL'} - Raw: ${s.raw.destinatario}, Expected: ${s.expected}, Got: ${result.destinatario}`);
    });
  }

  // --- CORE LOGIC: TRIANGULAÇÃO SNIPER STRICT ---
  private resolveIdentityLogic(raw: OcrExtractionResult, moradores: Morador[]): OcrExtractionResult {
      const finalResult = { ...raw };
      
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
              const partialMatches = [];

              for (const morador of moradoresDaUnidade) {
                  const moradorName = this.normalizeString(morador.nome);
                  const score = this.calculateSimilarity(rawName, moradorName);
                  
                  if (score > bestScore) {
                      bestScore = score;
                      bestMatch = morador;
                  }
                  
                  // Check for partial match (e.g., "AYLA" in "AYLA VITORIA")
                  if (rawName.length >= 3 && (moradorName.includes(rawName) || rawName.includes(moradorName))) {
                      partialMatches.push(morador);
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
              } else if (partialMatches.length === 1) {
                  // Se encontrou exatamente um morador com aquele nome parcial na unidade
                  const match = partialMatches[0];
                  console.log('[Logic] Match Parcial Único:', match.nome);
                  finalResult.destinatario = match.nome;
                  finalResult.matchedMoradorId = match.id;
                  finalResult.wasAutoCorrected = true;
                  return finalResult;
              } else {
                  // Se não bateu o nome, MANTÉM O OCR ORIGINAL.
                  // Nunca adivinhe que é o titular se o nome for diferente.
                  console.log('[Logic] Unidade detectada, mas nome distinto ou múltiplo. Retornando lista de moradores.');
                  finalResult.possibleMoradores = moradoresDaUnidade;
                  finalResult.bloco = bloco;
                  finalResult.apto = apto;
              }
          }
      }

      // 3. TENTATIVA FUZZY GLOBAL (Último recurso, muito cauteloso)
      if (rawName.length > 5) {
          const matches: { morador: Morador, score: number }[] = [];

          for (const morador of moradores) {
              const moradorName = this.normalizeString(morador.nome);
              const score = this.calculateSimilarity(rawName, moradorName);
              
              // Se o nome for exatamente igual ou contiver o nome escaneado de forma única
              if (score > 0.85 || (rawName.length > 8 && moradorName.includes(rawName)) || (moradorName.length > 8 && rawName.includes(moradorName))) {
                  matches.push({ morador, score: Math.max(score, 0.86) });
              }
          }

          // Ordena por score
          matches.sort((a, b) => b.score - a.score);

          if (matches.length === 1) {
              // Match único global: Certeza alta o suficiente para auto-preencher
              const best = matches[0].morador;
              console.log('[Logic] Match Global Único:', best.nome);
              finalResult.destinatario = best.nome;
              finalResult.matchedMoradorId = best.id;
              finalResult.wasAutoCorrected = true;
              return finalResult;
          } else if (matches.length > 1) {
              // Múltiplos matches: Se o primeiro for muito superior ao segundo
              if (matches[0].score - matches[1].score > 0.2) {
                  const best = matches[0].morador;
                  console.log('[Logic] Match Global Dominante:', best.nome);
                  finalResult.destinatario = best.nome;
                  finalResult.matchedMoradorId = best.id;
                  finalResult.wasAutoCorrected = true;
                  return finalResult;
              } else {
                  // Ambiguidade global: Retorna lista para seleção manual
                  console.log('[Logic] Ambiguidade Global Detectada.');
                  finalResult.possibleMoradores = matches.map(m => m.morador);
              }
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
      const costs = [];
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



  public async retrainSimbioseFromDatabase(): Promise<void> {
      console.log('[Simbiose] Retreinamento via Gemini iniciado (Simulado).');
      // No futuro, implementar retreinamento via Gemini se necessário.
      return Promise.resolve();
  }

  private loadMemory() {
      try { const stored = localStorage.getItem(this.MEMORY_KEY); if (stored) this.memory = JSON.parse(stored); } catch { /* ignore */ }
  }
  private saveMemory() {
      try { localStorage.setItem(this.MEMORY_KEY, JSON.stringify(this.memory)); } catch { /* ignore */ }
  }
  public exportarMemoria(): string { return JSON.stringify(this.memory, null, 2); }
  public importarMemoria(json: string): boolean {
    try { return this.fundirMemoria(JSON.parse(json)); } catch { return false; }
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
          const freshEntries = parsed.filter(([, entry]) => (Date.now() - entry.timestamp) < this.CACHE_LIFETIME_MS);
          this.ocrCache = new Map(freshEntries);
        }
      }
    } catch { localStorage.removeItem(this.CACHE_KEY); }
  }
  private saveOcrCache() { try { localStorage.setItem(this.CACHE_KEY, JSON.stringify(Array.from(this.ocrCache.entries()))); } catch { /* ignore */ } }
  private getOcrCacheEntry(key: string): OcrCacheEntry | undefined {
    const entry = this.ocrCache.get(key);
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
