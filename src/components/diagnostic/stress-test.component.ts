import { Component, inject, signal } from '@angular/core';
import { SecurityProtocolService } from '../../services/security-protocol.service';
import { DbService } from '../../services/db.service';
import { OcrExtractionResult } from '../../services/gemini.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stress-test',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-4">Diagnostic: Security Protocol Stress Test</h1>
      <button (click)="runStressTest()" class="bg-blue-500 text-white p-2 rounded">Run 1 Million Iterations</button>
      
      <div *ngIf="isRunning()" class="mt-4">Running...</div>
      <div *ngIf="result()" class="mt-4 p-4 border rounded">
        <p>Status: {{ result()?.status }}</p>
        <p>Time Taken: {{ result()?.timeTaken }}ms</p>
        <p>Patterns Processed: {{ result()?.patternsProcessed }}</p>
      </div>
    </div>
  `
})
export class StressTestComponent {
  private securityService = inject(SecurityProtocolService);
  private dbService = inject(DbService);
  
  isRunning = signal(false);
  result = signal<{ status: string, timeTaken: number, patternsProcessed: number } | null>(null);

  async runStressTest() {
    this.isRunning.set(true);
    
    const moradores = this.dbService.moradores();
    const patterns: OcrExtractionResult[] = [];
    for (let i = 0; i < 599; i++) {
      patterns.push({
        destinatario: i % 10 === 0 ? 'UNKNOWN' : `Morador ${i}`,
        localizacao: `BL ${i % 5} AP ${i % 100}`,
        transportadora: i % 20 === 0 ? 'PARTICULAR' : 'CORREIOS',
        confianca: 0.9,
        bloco: `${i % 5}`,
        apto: `${i % 100}`
      } as OcrExtractionResult);
    }

    const iterations = 1000000;
    const startTime = performance.now();
    
    for (let i = 0; i < iterations; i++) {
      const pattern = patterns[i % 599];
      this.securityService.analyze(pattern, moradores);
    }
    
    const endTime = performance.now();
    
    this.result.set({
      status: 'Completed',
      timeTaken: Math.round(endTime - startTime),
      patternsProcessed: iterations
    });
    this.isRunning.set(false);
  }
}
