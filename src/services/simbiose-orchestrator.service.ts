import { Injectable, inject } from '@angular/core';
import { DbService, Morador } from '../services/db.service';
import { GeminiService, OcrExtractionResult } from '../services/gemini.service';
import { ExclusiveScannerService } from '../services/exclusive-scanner.service';

@Injectable({
  providedIn: 'root'
})
export class SimbioseOrchestratorService {
  private db = inject(DbService);
  private gemini = inject(GeminiService);
  private scanner = inject(ExclusiveScannerService);

  public async processLabel(imageBase64: string): Promise<OcrExtractionResult> {
    const startTime = performance.now();

    // 1. Motor 1, 2, 3: Parallel Extraction (Simulated)
    const [ocrResult, qrCode, tesseractResult] = await Promise.all([
      this.scanner.runOCR(imageBase64),
      this.simulateGoogleLens(),
      this.simulateTesseract()
    ]);

    // 2. Motor 4: Adobe Acrobat AI Assistant Simulation
    const adobeParsed = this.simulateAdobeAcrobatAI();

    // 3. Motor 6: DeepSeek Tokenization & Cross-reference
    const tokenizedData = this.simulateDeepSeekTokenization(adobeParsed, this.db.moradores());

    // 4. Motor 5: Gemini Verdict
    const finalVerdict = await this.gemini.enviarParaAnalise(JSON.stringify({
      ocr: ocrResult,
      qr: qrCode,
      tesseract: tesseractResult,
      adobe: adobeParsed,
      deepSeek: tokenizedData
    }));

    // Intelligent Matching Logic
    const matchedMorador = this.findBestMatch(finalVerdict.destinatario, finalVerdict.bloco, finalVerdict.apto);
    if (matchedMorador) {
        finalVerdict.destinatario = matchedMorador.nome;
        finalVerdict.bloco = matchedMorador.bloco;
        finalVerdict.apto = matchedMorador.apto;
    }

    const endTime = performance.now();
    console.log(`[SIMBIOSE] Leitura finalizada em ${((endTime - startTime) / 1000).toFixed(2)}s`);

    return finalVerdict;
  }

  private findBestMatch(nome: string, bloco: string, apto: string): Morador | undefined {
      const moradores = this.db.moradores();
      // Try exact match
      let match = moradores.find(m => m.nome.toUpperCase() === nome.toUpperCase() && m.bloco === bloco && m.apto === apto);
      if (match) return match;
      
      // Try fuzzy match for name + unit
      match = moradores.find(m => (m.nome.toUpperCase().includes(nome.toUpperCase()) || nome.toUpperCase().includes(m.nome.toUpperCase())) && m.bloco === bloco && m.apto === apto);
      return match;
  }

  private async simulateGoogleLens(): Promise<string> {
    return 'QR_CODE_DATA_12345';
  }

  private async simulateTesseract(): Promise<string> {
    return 'TESSERACT_OCR_TEXT';
  }

  private simulateAdobeAcrobatAI(): { destinatario: string, bloco: string, apto: string, transportadora: string } {
    return { destinatario: 'João', bloco: '1', apto: '101', transportadora: 'CORREIOS' };
  }

  private simulateDeepSeekTokenization(data: { destinatario: string, bloco: string, apto: string }, moradores: Morador[]): { tokenizedName: string[], matchFound: boolean, fullName: string } {
    const morador = moradores.find(m => m.nome.includes(data.destinatario) || (m.bloco === data.bloco && m.apto === data.apto));
    return {
      tokenizedName: data.destinatario.split(' '),
      matchFound: !!morador,
      fullName: morador ? morador.nome : data.destinatario
    };
  }
}
