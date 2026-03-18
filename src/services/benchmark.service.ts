import { Injectable, signal } from '@angular/core';

export interface BenchmarkResult {
  name: string;
  duration: number; // in milliseconds
  timestamp: string;
}

@Injectable({
  providedIn: 'root'
})
export class BenchmarkService {
  private timers = new Map<string, number>();
  results = signal<BenchmarkResult[]>([]);

  /**
   * Starts a performance timer for a given operation.
   * @param name - A unique identifier for the benchmark.
   */
  public start(name: string): void {
    if (this.timers.has(name)) {
      console.warn(`[Benchmark] Timer '${name}' já foi iniciado. Reiniciando.`);
    }
    this.timers.set(name, performance.now());
  }

  /**
   * Stops a performance timer, calculates the duration, and logs the result.
   * @param name - The unique identifier of the benchmark to stop.
   */
  public end(name: string): void {
    const startTime = this.timers.get(name);

    if (!startTime) {
      console.warn(`[Benchmark] Timer '${name}' não foi encontrado para ser finalizado.`);
      return;
    }

    const endTime = performance.now();
    const duration = endTime - startTime;
    this.timers.delete(name);

    const result: BenchmarkResult = {
      name,
      duration,
      timestamp: new Date().toISOString()
    };
    
    this.results.update(current => [...current, result]);
    this.logResult(result);
  }

  private logResult(result: BenchmarkResult): void {
    const durationFormatted = result.duration.toFixed(2);
    const color = result.duration < 500 ? '#4ade80' : result.duration < 2000 ? '#facc15' : '#f87171';
    
    console.log(
      `%c[PERF] ${result.name}: %c${durationFormatted}ms`,
      'color: #a855f7; font-weight: bold;', // Purple
      `color: ${color}; font-weight: bold;`
    );
  }

  public async runAll(): Promise<void> {
    console.log('%c[Benchmark] Iniciando suíte de testes de performance...', 'color: #0ea5e9; font-size: 1.2em;');
    this.start('full_suite');
    await new Promise(r => setTimeout(r, 100)); // Mock
    this.end('full_suite');
    console.log('%c[Benchmark] Suíte de testes concluída.', 'color: #0ea5e9; font-size: 1.2em;');
  }
}