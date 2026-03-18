import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScannerService } from '../../app/services/scanner.service';

@Component({
  selector: 'app-simple-scanner',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="simbiose-container">
  <h2 style="color: #ff6a00; text-shadow: 0 0 10px #ff6a00;">SIMBIOSE V4.7 - SCANNER</h2>
  
  <button (click)="iniciarLeitura()" class="btn-neon">
    INICIAR SCANNER REAL-TIME
  </button>

  @if (resultado()) {
    <div class="feedback-leitura">
      Conteúdo Lido: <strong>{{ resultado() }}</strong>
    </div>
  }
</div>
`,
  styles: [`
    .simbiose-container { padding: 20px; text-align: center; }
    .btn-neon {
      background: transparent;
      border: 2px solid #ff6a00;
      color: #ff6a00;
      padding: 15px 30px;
      box-shadow: 0 0 15px #ff6a00;
      cursor: pointer;
      transition: 0.3s;
    }

    .btn-neon:hover {
      background: #ff6a00;
      color: #000;
    }
    .feedback-leitura { margin-top: 20px; color: white; }
  `]
})
export class SimpleScannerComponent {
  private scannerService = inject(ScannerService);
  resultado = signal('');

  async iniciarLeitura() {
    const res = await this.scannerService.scanLogistica();
    this.resultado.set(res);
  }
}
