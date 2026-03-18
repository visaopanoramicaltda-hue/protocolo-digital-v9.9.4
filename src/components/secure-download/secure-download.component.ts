

import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { SimbioseStorageService } from '../../services/core/simbiose-storage.service';

@Component({
  selector: 'app-secure-download',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-center font-mono relative overflow-hidden">
      
      <!-- Background Effects -->
      <div class="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 pointer-events-none"></div>
      <div class="absolute inset-0 bg-gradient-to-b from-red-900/10 to-black pointer-events-none"></div>

      <div class="relative z-10 max-w-md w-full bg-gray-900/80 backdrop-blur-xl border border-red-500/30 p-8 rounded-2xl shadow-[0_0_50px_rgba(239,68,68,0.1)]">
        
        <!-- Icon -->
        <div class="mb-6 flex justify-center">
          <div class="w-20 h-20 rounded-full bg-black border-2 border-red-500 flex items-center justify-center shadow-[0_0_20px_rgba(239,68,68,0.4)] relative">
             <svg class="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
        </div>

        <h2 class="text-2xl font-black text-white uppercase tracking-widest mb-2">
          Função Desativada
        </h2>
        <p class="text-xs text-red-500 uppercase tracking-widest mb-8 border-b border-red-900/50 pb-4">
          Operação 100% Offline
        </p>

        <div class="bg-red-900/20 border border-red-500/50 text-red-400 p-4 rounded-xl text-sm mb-6">
          O download seguro de arquivos foi descontinuado para garantir a soberania total dos dados no modo offline.
        </div>
        <p class="text-xs text-gray-500">Comprovantes agora são gerados e armazenados apenas localmente no seu dispositivo.</p>

      </div>
      
      <div class="mt-8 text-[10px] text-gray-600 font-mono uppercase">
        Protected by Simbiose Offline-First Architecture
      </div>
    </div>
  `
})
export class SecureDownloadComponent implements OnInit {
  private route = inject(ActivatedRoute);

  loading = signal(true);
  error = signal(true);
  success = signal(false);
  errorMessage = signal('Link de download de uso único expirado ou desativado.');
  logs = signal<string[]>(['FALHA CRÍTICA: Rota de nuvem desativada.']);

  ngOnInit() {
    // A funcionalidade foi desativada, então apenas mostramos o estado de erro.
    this.loading.set(false);
  }
}
