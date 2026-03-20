
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
  immutableDataset?: string; // NOVO: Dataset gerado a partir do histórico
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
  
  private async enviarParaAnaliseTurbo(contexto: string, regexHints: Record<string, unknown>): Promise<OcrExtractionResult> {
      const systemInstruction = `
        A partir de agora, o processamento de imagem/OCR bruto é realizado localmente via Google ML Kit.
        Entrada de Dados: Você receberá strings de texto pré-processadas.
        Missão: Sua função é exclusivamente a análise lógica, categorização e validação dos dados recebidos.
        Modo Econômico: Responda de forma concisa (JSON) para minimizar o uso de tokens de saída.
        Foco: Logística, conferência de etiquetas e protocolos de segurança.
        
        Por que isso economiza dinheiro?
        Gemini Flash 1.5: Você deixará de enviar arquivos de imagem pesados para a nuvem (que consomem muitos tokens).
        Input de Texto: Enviar apenas o texto extraído pelo ML Kit custa frações de centavos ou entra na cota gratuita do nível gratuito (Free Tier), já que o volume de caracteres é baixo comparado a uma imagem em alta resolução.
        
        ${this.memory.immutableDataset ? `[DATASET IMUTÁVEL - APRENDIZADO CONTÍNUO SIMBIOSE]\n${this.memory.immutableDataset}\nUse este dataset validado pelo sistema Simbiose para melhorar a precisão da extração de dados e ensinar seus auxiliares a reconhecer padrões de apelidos, blocos e apartamentos.\n` : ''}
        
        REGRAS:
        - Extraia destinatario, bloco, apto EXATAMENTE como na etiqueta, mas use o Dataset Imutável para inferir apelidos comuns (ex: Jão -> João) se o bloco e apartamento baterem com precisão.
        - Se o RegexHints contiver um qrCode, extraia o código de rastreio dele (removendo URLs, pegando apenas o ID alfanumérico principal). Se o qrCode for apenas um código, use-o como rawRastreio.
        - Se não estiver CLARO e LEGÍVEL, retorne vazio.
        - Não adivinhe, não deduza fora do contexto do Dataset Imutável.
        - Retorne apenas JSON: {destinatario, bloco, apto, transportadora, rawRastreio, confianca}
      `;
      
      const prompt = `
        Texto: "${contexto}"
        RegexHints: ${JSON.stringify(regexHints)}
      `;
      
      try {
          const response = await this.genAI.models.generateContent({
            model: 'gemini-3.1-flash-lite-preview',
            contents: prompt,
            config: { 
              systemInstruction,
              responseMimeType: 'application/json', 
              temperature: 0.0 
            }
          });
          const parsed = JSON.parse(response.text || '{}');
          return {
              destinatario: parsed.destinatario || '',
              bloco: parsed.bloco || '',
              apto: parsed.apto || '',
              localizacao: (parsed.bloco && parsed.apto) ? `${parsed.bloco} ${parsed.apto}` : '',
              transportadora: parsed.transportadora || 'LEITURA MANUAL',
              confianca: parsed.confianca || 0.5,
              rawRastreio: parsed.rawRastreio,
              condicaoVisual: 'Intacta',
          };
      } catch {
          return this.emptyResult();
      }
  }

  public async enviarParaAnalise(contexto: string): Promise<OcrExtractionResult> {
      const systemInstruction = `
        A partir de agora, o processamento de imagem/OCR bruto é realizado localmente via Google ML Kit.
        Entrada de Dados: Você receberá strings de texto pré-processadas.
        Missão: Sua função é exclusivamente a análise lógica, categorização e validação dos dados recebidos.
        Modo Econômico: Responda de forma concisa (JSON) para minimizar o uso de tokens de saída.
        Foco: Logística, conferência de etiquetas e protocolos de segurança.
        
        Por que isso economiza dinheiro?
        Gemini Flash 1.5: Você deixará de enviar arquivos de imagem pesados para a nuvem (que produz muitos tokens).
        Input de Texto: Enviar apenas o texto extraído pelo ML Kit custa frações de centavos ou entra na cota gratuita do nível gratuito (Free Tier), já que o volume de caracteres é baixo comparado a uma imagem em alta resolução.
        
        ${this.memory.immutableDataset ? `[DATASET IMUTÁVEL - APRENDIZADO CONTÍNUO SIMBIOSE]\n${this.memory.immutableDataset}\nUse este dataset validado pelo sistema Simbiose para melhorar a precisão da extração de dados e ensinar seus auxiliares a reconhecer padrões de apelidos, blocos e apartamentos.\n` : ''}
        
        CAMPOS:
        1. destinatario: Nome completo.
        2. bloco: Bloco/Torre.
        3. apto: Unidade.
        4. transportadora: Identifique a transportadora (SHOPEE, MERCADO LIVRE, AMAZON, CORREIOS, LOGGI, JADLOG, etc.).
        5. rawRastreio: Código de rastreio.
        
        REGRAS DE VALIDAÇÃO (CRÍTICO):
        - EXTRAÇÃO ESTRITA: SE VOCÊ NÃO TIVER 100% DE CERTEZA, RETORNE UMA STRING VAZIA ('') PARA O CAMPO. NÃO TENTE COMPLETAR DADOS FALTANTES. A PRECISÃO É MAIS IMPORTANTE QUE O PREENCHIMENTO.
        - NOME: Extraia o nome EXATAMENTE como aparece no texto. Use o Dataset Imutável APENAS para validar apelidos SE o bloco e apartamento baterem com precisão.
        - BLOCO E APARTAMENTO: Extraia EXATAMENTE como aparecem na etiqueta. NUNCA invente, deduza ou tente adivinhar. Se não estiver CLARO e LEGÍVEL na etiqueta, retorne vazio.
        - A transportadora deve ser identificada PRIMEIRO.
        - CÓDIGO DE RASTREIO (EXTREMA PRECISÃO): O código de rastreio DEVE corresponder exatamente ao padrão da transportadora. Se houver qualquer dúvida, ou se não for um código válido, DEIXE O CAMPO VAZIO.
          - Se o texto contiver um "QR Code/Lens", extraia o código de rastreio dele (removendo URLs, pegando apenas o ID alfanumérico principal). Se for apenas um código, use-o como rawRastreio.
          - CORREIOS: 2 letras + 9 números + 2 letras (ex: AA123456789BR).
          - SHOPEE (SPX): Começa com BR seguido de 10 a 15 números.
          - MERCADO LIVRE: Começa com MLB seguido de 10 a 15 números.
          - AMAZON: Começa com TBA ou AMZ seguido de 10 a 15 números.
          - LOGGI: Começa com LOG seguido de 10 a 15 números.
          - JADLOG: Exatamente 14 números ou JAD seguido de 10 a 15 números.
          - OUTROS: 3 letras seguidas de 10 a 15 números.
        - O texto "VESNINATARIO", "DESTINATARIO", "REMETENTE", "PEDIDO", "NOTA" NUNCA é um código de rastreio. Ignore-os.
        - NÃO adivinhe NENHUM dado. Se não tiver certeza absoluta, deixe o campo vazio.
      `;
      
      const prompt = `
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
              systemInstruction: systemInstruction,
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
        
        // Adiciona o QR Code nas dicas para o Gemini
        if (localHints.qrCode) {
            regexHints['qrCode'] = localHints.qrCode;
        }
        
        // [MOTOR DEDICADO DE RASTREIO]
        // Aplica a verdade absoluta do regex. O QR Code será analisado pelo Gemini.
        const dedicatedRastreio = regexHints.rastreio;

        if (turboActive) {
            // [MODO TURBO] Análise lógica ultra-rápida (menos tokens)
            rawResult = await this.enviarParaAnaliseTurbo(filteredText, regexHints);
        } else if (filteredText && filteredText.length > 5) {
            // [GEMINI VEREDITO] Envia o texto filtrado + dicas de regex para análise lógica
            const promptContext = `
              Texto Filtrado (OCR): "${filteredText}"
              Dicas de Regex: ${JSON.stringify(regexHints)}
              QR Code/Lens: ${localHints.qrCode || 'Não detectado'}
            `;
            
            rawResult = await this.enviarParaAnalise(promptContext);
        } else {
            // Fallback para o parser local se o texto for muito curto
            const scanResult = await this.scannerV4.processScan(imageBase64);
            rawResult = {
                destinatario: scanResult.destinatario,
                transportadora: scanResult.transportadora,
                rawRastreio: dedicatedRastreio,
                confianca: scanResult.confidence / 100,
                localizacao: regexHints.bloco && regexHints.apto ? `${regexHints.bloco} ${regexHints.apto}` : '',
                condicaoVisual: 'Intacta'
            };
        }

        // [MOTOR DEDICADO DE RASTREIO] - Aplica a verdade absoluta do regex
        if (dedicatedRastreio) {
            rawResult.rawRastreio = dedicatedRastreio;
        } else if (localHints.qrCode) {
            // Se o usuário escaneou um QR Code, ele tem prioridade sobre o Gemini para o rastreio
            let qr = localHints.qrCode.trim();
            if (qr.endsWith('/')) qr = qr.slice(0, -1);
            
            let possibleTracking = '';
            try {
                // Tenta fazer parse como URL
                const url = new URL(qr);
                
                // Tenta pegar o primeiro parâmetro de query que pareça um código
                let queryParam = '';
                url.searchParams.forEach((value) => {
                    if (!queryParam && value.length > 5) {
                        queryParam = value;
                    }
                });
                
                // Tenta pegar o último segmento do path
                const pathSegments = url.pathname.split('/').filter(s => s.length > 0);
                const lastSegment = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : '';
                
                // Prefere o query param se existir e for longo, senão o path segment, senão a URL inteira
                possibleTracking = queryParam || lastSegment || qr;
            } catch (e) {
                // Não é URL, usa o QR code inteiro (ou tenta separar por = ou / se for uma string mal formatada)
                if (qr.includes('http') && qr.includes('=')) {
                    possibleTracking = qr.split('=').pop() || '';
                } else if (qr.includes('http') && qr.includes('/')) {
                    possibleTracking = qr.split('/').pop() || '';
                } else {
                    possibleTracking = qr;
                }
            }
            
            // Remove espaços e hífens para testar se é alfanumérico
            const cleanTracking = possibleTracking.replace(/[\s-]/g, '');
            
            // Só usa se parecer um código de rastreio (alfanumérico, mais de 5 caracteres, e contém pelo menos um número)
            if (cleanTracking && cleanTracking.length > 5 && /^[A-Za-z0-9]+$/.test(cleanTracking) && /\d/.test(cleanTracking)) {
                rawResult.rawRastreio = possibleTracking; // Mantém a formatação original
            }
        }
        
        // Garante que não seja undefined/null
        if (!rawResult.rawRastreio) {
            rawResult.rawRastreio = '';
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
      { id: '3', nome: 'PEDRO SANTOS', bloco: 'B', apto: '202' },
      { id: '4', nome: 'JOAO SILVA SAURO MENEZES', bloco: '1', apto: '101' },
      { id: '5', nome: 'MARIA SILVA', bloco: '1', apto: '101' }
    ];

    const scenarios = [
      { raw: { destinatario: 'JOAO SILVA', localizacao: 'BL A AP 101', transportadora: 'CORREIOS', confianca: 1.0 }, expected: 'JOAO SILVA' },
      { raw: { destinatario: 'J0AO SILVA', localizacao: 'BL A AP 101', transportadora: 'CORREIOS', confianca: 0.9 }, expected: 'JOAO SILVA' },
      { raw: { destinatario: 'MARIA', localizacao: 'BL A AP 101', transportadora: 'CORREIOS', confianca: 0.8 }, expected: 'MARIA SOUZA' },
      { raw: { destinatario: 'PEDRO', localizacao: 'BL B AP 202', transportadora: 'CORREIOS', confianca: 0.9 }, expected: 'PEDRO SANTOS' },
      { raw: { destinatario: 'JOAO SILVA', localizacao: 'BL B AP 202', transportadora: 'CORREIOS', confianca: 0.9 }, expected: 'JOAO SILVA' }, // Should not match
      { raw: { destinatario: 'JAO', localizacao: 'BL 1 AP 101', transportadora: 'CORREIOS', confianca: 0.9 }, expected: 'JOAO SILVA SAURO MENEZES' }
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
      if (this.memory.residentAliases && this.memory.residentAliases[rawName]) {
          const residentId = this.memory.residentAliases[rawName];
          const resident = moradores.find(m => m.id === residentId);
          if (resident) {
              finalResult.destinatario = resident.nome;
              finalResult.matchedMoradorId = resident.id;
              finalResult.wasAutoCorrected = true;
              finalResult.bloco = resident.bloco;
              finalResult.apto = resident.apto;
              return finalResult;
          }
      }

      // 2. TENTATIVA POR NOME DIRETO (PRIORIDADE MÁXIMA)
      const moradorPorNome = moradores.find(m => this.normalizeString(m.nome) === rawName);
      if (moradorPorNome) {
          finalResult.matchedMoradorId = moradorPorNome.id;
          finalResult.bloco = moradorPorNome.bloco;
          finalResult.apto = moradorPorNome.apto;
          return finalResult;
      }

      // 3. TRIANGULAÇÃO DE BLOCO/APTO
      let bloco = raw.bloco;
      let apto = raw.apto;

      if (!bloco || !apto) {
          const locationData = this.parseLocationString(raw.localizacao) || this.parseLocationString(raw.destinatario);
          if (locationData) {
              bloco = locationData.bloco;
              apto = locationData.apto;
          }
      }
      
      if (bloco && apto) {
          const moradoresDaUnidade = moradores.filter(m => 
              this.normalizeString(m.bloco) === this.normalizeString(bloco) && 
              this.normalizeString(m.apto) === this.normalizeString(apto)
          );

          if (moradoresDaUnidade.length === 1) {
              const morador = moradoresDaUnidade[0];
              finalResult.destinatario = morador.nome;
              finalResult.matchedMoradorId = morador.id;
              finalResult.bloco = morador.bloco;
              finalResult.apto = morador.apto;
              return finalResult;
          } else if (moradoresDaUnidade.length > 1) {
              // Desempate pelo nome lido (rawName)
              if (rawName && rawName.length >= 2) {
                  const matchesUnidade = moradoresDaUnidade.map(m => {
                      const mName = this.normalizeString(m.nome);
                      let score = this.calculateSimilarity(rawName, mName);
                      
                      // Bônus se for substring direta
                      if (mName.includes(rawName) || rawName.includes(mName)) {
                          score += 0.5;
                      } else if (this.isNameMatch(rawName, mName)) {
                          score += 0.4;
                      } else {
                          // Bônus para apelidos/abreviações na primeira palavra (ex: JAO -> JOAO)
                          const rawWords = rawName.split(' ');
                          const mWords = mName.split(' ');
                          if (rawWords.length > 0 && mWords.length > 0) {
                              const firstWordSim = this.calculateSimilarity(rawWords[0], mWords[0]);
                              if (firstWordSim >= 0.6) {
                                  score += 0.4;
                              }
                              // Bônus extra se for um apelido muito comum ou prefixo
                              if (mWords[0].startsWith(rawWords[0]) || rawWords[0].startsWith(mWords[0])) {
                                  score += 0.2;
                              }
                          }
                      }
                      return { morador: m, score };
                  }).sort((a, b) => b.score - a.score);

                  // Se o melhor match se destacar
                  if (matchesUnidade[0].score > 0.4) {
                      if (matchesUnidade.length === 1 || (matchesUnidade[0].score - matchesUnidade[1].score > 0.15)) {
                          const best = matchesUnidade[0].morador;
                          finalResult.destinatario = best.nome;
                          finalResult.matchedMoradorId = best.id;
                          finalResult.bloco = best.bloco;
                          finalResult.apto = best.apto;
                          finalResult.wasAutoCorrected = true;
                          return finalResult;
                      }
                  }
              }
              finalResult.possibleMoradores = moradoresDaUnidade;
          }
      }

      // 4. TENTATIVA FUZZY GLOBAL (Último recurso, muito cauteloso)
      if (rawName.length > 5) {
          const matches: { morador: Morador, score: number }[] = [];

          const rawLoc: string[] = rawName.match(/\d+/g) || []; // Extrai todos os números do nome lido
          const rawNameNoNum = rawName.replace(/[0-9]/g, '').trim();

          for (const morador of moradores) {
              const moradorName = this.normalizeString(morador.nome);
              const mNameNoNum = moradorName.replace(/[0-9]/g, '').trim();
              
              let score = this.calculateSimilarity(rawNameNoNum, mNameNoNum);
              
              // Bônus de nome
              if (mNameNoNum.includes(rawNameNoNum) || rawNameNoNum.includes(mNameNoNum)) {
                  score += 0.5;
              } else if (this.isNameMatch(rawNameNoNum, mNameNoNum)) {
                  score += 0.4;
              } else if (this.isNameMatch(rawName, moradorName)) {
                  score += 0.4;
              }

              // Bônus GIGANTE se o bloco e apartamento baterem (Verdade Absoluta)
              const mBloco = this.normalizeString(morador.bloco);
              const mApto = this.normalizeString(morador.apto);
              const moradorLoc: string[] = moradorName.match(/\d+/g) || [];
              
              let locMatch = false;
              
              // 1. Se o OCR extraiu bloco e apto e eles batem com o cadastro
              if (bloco && apto && mBloco === this.normalizeString(bloco) && mApto === this.normalizeString(apto)) {
                  locMatch = true;
              } 
              // 2. Se o nome lido contém os números do bloco e apto do cadastro
              else if (mBloco && mApto && rawLoc.includes(mBloco) && rawLoc.includes(mApto)) {
                  locMatch = true;
              }
              // 3. Se o nome lido contém os mesmos números que o nome do cadastro
              else if (rawLoc.length >= 2 && moradorLoc.length >= 2) {
                  const shared = rawLoc.filter(r => moradorLoc.includes(r));
                  if (shared.length >= 2) locMatch = true;
              }

              if (locMatch && score > 0.3) {
                  // Se o bloco e apto baterem e houver uma similaridade mínima de nome, é ele!
                  score += 2.0; 
              }

              if (score > 0.85) {
                  matches.push({ morador, score });
              }
          }

          // Ordena por score
          matches.sort((a, b) => b.score - a.score);

          if (matches.length > 0) {
              // Se o primeiro tiver um score > 2.0 (LocMatch) ou for muito superior ao segundo
              if (matches.length === 1 || (matches[0].score - matches[1].score > 0.15)) {
                  const best = matches[0].morador;
                  console.log('[Logic] Match Global Dominante/Único:', best.nome);
                  finalResult.destinatario = best.nome;
                  finalResult.matchedMoradorId = best.id;
                  finalResult.bloco = best.bloco;
                  finalResult.apto = best.apto;
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
  private isNameMatch(scannedName: string, dbName: string): boolean {
      if (!scannedName || !dbName) return false;
      
      // Remove números para focar apenas no nome (o bloco/apto será tratado separadamente)
      const cleanScanned = scannedName.replace(/[0-9]/g, '').trim();
      const cleanDb = dbName.replace(/[0-9]/g, '').trim();
      
      const scannedParts = cleanScanned.split(' ').filter(p => p.length > 1);
      const dbParts = cleanDb.split(' ').filter(p => p.length > 1);
      
      if (scannedParts.length === 0 || dbParts.length === 0) return false;

      const allScannedInDb = scannedParts.every(part => dbParts.includes(part));
      const allDbInScanned = dbParts.every(part => scannedParts.includes(part));

      return allScannedInDb || allDbInScanned;
  }

  private normalizeString(str: string | undefined | null): string {
    return (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[\/\-]/g, " ").replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  }

  private parseLocationString(text: string): { bloco: string, apto: string } | null {
      if (!text) return null;
      // Normaliza removendo acentos e passando para maiúsculo, mas MANTÉM / e - para ajudar no regex
      const rawClean = (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
      
      // Tenta formato 1/101 ou 1-101
      const regexSlash = /([A-Z0-9]+)\s*[\/\-]\s*([0-9]+)/;
      const matchSlash = rawClean.match(regexSlash);
      if (matchSlash) return { bloco: matchSlash[1], apto: matchSlash[2] };

      const clean = this.normalizeString(text);
      
      // Tenta formato BL 1 AP 101
      const regexComplex = /BL.*?([A-Z0-9]+).*?AP.*?([0-9]+)/;
      const match = clean.match(regexComplex);
      if (match) return { bloco: match[1], apto: match[2] };
      
      // Tenta formato onde os dois últimos tokens são números (ex: JOAO 1 101)
      const parts = clean.split(' ').filter(p => p.trim() !== '');
      if (parts.length >= 2) {
          const last = parts[parts.length - 1];
          const secondLast = parts[parts.length - 2];
          if (/^\d+$/.test(last) && /^[A-Z0-9]+$/.test(secondLast)) {
              // Se o último for só número (apto) e o penúltimo for alfanumérico (bloco)
              return { bloco: secondLast, apto: last };
          }
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
      console.log('[Simbiose] Retreinamento via Gemini iniciado...');
      this.evolutionStatus.set('EVOLVING');
      
      try {
          // 1. Coleta o histórico de encomendas ENTREGUES
          const encomendas = this.db.encomendas().filter(e => e.status === 'ENTREGUE');
          
          if (encomendas.length === 0) {
              this.evolutionStatus.set('IDLE');
              return;
          }

          // 2. Extrai padrões (Transportadoras mais comuns, Blocos/Aptos mais comuns)
          const transportadoras = new Set<string>();
          const blocos = new Set<string>();
          const aptos = new Set<string>();
          
          encomendas.forEach(e => {
              if (e.transportadora && e.transportadora !== 'LEITURA MANUAL') transportadoras.add(e.transportadora);
              if (e.bloco) blocos.add(e.bloco);
              if (e.apto) aptos.add(e.apto);
          });

          // 3. Constrói o Dataset Imutável
          const dataset = `
            [DATASET IMUTÁVEL SIMBIOSE]
            Total de Amostras Entregues: ${encomendas.length}
            Transportadoras Frequentes: ${Array.from(transportadoras).slice(0, 10).join(', ')}
            Padrões de Bloco/Torre: ${Array.from(blocos).slice(0, 10).join(', ')}
            Padrões de Apartamento/Unidade: ${Array.from(aptos).slice(0, 10).join(', ')}
            
            Exemplos de Nomes Validados (Aliases Aprendidos):
            ${Object.entries(this.memory.residentAliases || {}).slice(0, 5).map(([alias]) => `- Lido como "${alias}" -> Corrigido no sistema`).join('\n')}
          `;

          this.memory.immutableDataset = dataset;
          this.memory.lastTraining = Date.now();
          this.memory.neuralVersion = (this.memory.neuralVersion || 1) + 1;
          this.saveMemory();
          
          this.lastEvolution.set(new Date().toLocaleTimeString());
          this.evolutionStatus.set('COMPLETE');
          console.log('[Simbiose] Dataset Imutável gerado com sucesso:', dataset);
          
          setTimeout(() => this.evolutionStatus.set('IDLE'), 3000);
      } catch (error) {
          console.error('[Simbiose] Falha no retreinamento:', error);
          this.evolutionStatus.set('IDLE');
      }
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
