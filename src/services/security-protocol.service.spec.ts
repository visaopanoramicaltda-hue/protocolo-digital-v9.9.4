import { TestBed } from '@angular/core/testing';
import { SecurityProtocolService } from './security-protocol.service';
import { DbService, Morador } from './db.service';
import { OcrExtractionResult } from './gemini.service';

describe('SecurityProtocolService Stress Test', () => {
  let service: SecurityProtocolService;
  let dbServiceSpy: jasmine.SpyObj<DbService>;

  beforeEach(() => {
    const spy = jasmine.createSpyObj('DbService', ['moradores']);
    
    TestBed.configureTestingModule({
      providers: [
        SecurityProtocolService,
        { provide: DbService, useValue: spy }
      ]
    });
    service = TestBed.inject(SecurityProtocolService);
    dbServiceSpy = TestBed.inject(DbService) as jasmine.SpyObj<DbService>;
  });

  it('should run 1 million iterations with 599 patterns', () => {
    // 1. Generate 599 label patterns (OcrExtractionResult)
    const patterns: OcrExtractionResult[] = [];
    for (let i = 0; i < 599; i++) {
      patterns.push({
        destinatario: i % 10 === 0 ? 'UNKNOWN' : `Morador ${i}`,
        localizacao: `BL ${i % 5} AP ${i % 100}`,
        transportadora: i % 20 === 0 ? 'PARTICULAR' : 'CORREIOS',
        confianca: 0.9,
        bloco: `${i % 5}`,
        apto: `${i % 100}`
      });
    }

    // 2. Generate mock moradores
    const moradores: Morador[] = [];
    for (let i = 0; i < 100; i++) {
      moradores.push({
        id: `${i}`,
        nome: `Morador ${i}`,
        bloco: `${i % 5}`,
        apto: `${i % 100}`
      });
    }

    // 3. Run 1 million iterations
    const iterations = 1000000;
    const startTime = performance.now();
    
    for (let i = 0; i < iterations; i++) {
      const pattern = patterns[i % 599];
      service.analyze(pattern, moradores);
    }
    
    const endTime = performance.now();
    console.log(`[StressTest] Completed ${iterations} iterations in ${((endTime - startTime) / 1000).toFixed(2)}s`);
    
    // Basic validation: ensure it returns a valid verdict
    const verdict = service.analyze(patterns[0], moradores);
    expect(verdict).toBeDefined();
    expect(['SAFE', 'WARNING', 'CRITICAL']).toContain(verdict.status);
  });
});
