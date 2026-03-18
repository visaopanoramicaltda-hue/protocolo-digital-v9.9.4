import { Component, inject, signal, effect, OnDestroy, computed, OnInit } from '@angular/core';
import { RouterOutlet, Router, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { AuthService } from './services/auth.service';
import { DbService } from './services/db.service';
import { UiService } from './services/ui.service';
import { DataProtectionService } from './services/data-protection.service';
import { QuantumNetService } from './services/core/quantum-net.service';
import { GeminiService } from './services/gemini.service'; 
import { DeepSeekService } from './services/deep-seek.service';
import { CommonModule, PlatformLocation } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter } from 'rxjs/operators';
import { BackPressService } from './services/core/back-press.service';
import { SingleSessionService } from './services/core/single-session.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule, FormsModule],
  host: {
    '(touchstart)': 'onPullStart($event)',
    '(touchend)': 'onPullEnd($event)'
  },
  template: `
<!-- INITIALIZATION LAYER -->
@if (initStatus() === 'loading') {
  <div class="h-screen w-full bg-[#050505] flex flex-col items-center justify-center p-6 text-center font-serif relative overflow-hidden">
      <!-- Background Effect -->
      <div class="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')] opacity-20 pointer-events-none"></div>
      
      <h2 class="text-[#E86C26] text-2xl md:text-3xl font-black uppercase tracking-widest mb-8 animate-pulse z-10" 
          style="text-shadow: 0 0 20px rgba(232, 108, 38, 0.5);">
          SIMBIOSE: CARREGANDO...
      </h2>
      <div class="w-16 h-16 border-4 border-[#2a2320] border-t-[#E86C26] rounded-full animate-spin z-10"></div>
  </div>
} @else if (initStatus() === 'error') {
  <div class="h-screen w-full bg-[#050505] flex flex-col items-center justify-center p-6 text-center font-serif relative">
      <div class="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')] opacity-20 pointer-events-none"></div>

      <div class="bg-[#EAE0D5] border-4 border-[#E86C26] p-10 max-w-[400px] w-full text-center relative z-10 shadow-2xl rounded-sm transform rotate-1">
          <h2 class="text-2xl font-black uppercase tracking-widest mb-6 border-b-2 border-[#2a2320] pb-4">
              SISTEMA TRAVADO
          </h2>
          
          <div class="bg-[#F2EBE5] border border-[#2a2320] p-4 mb-6 text-left text-xs text-[#2a2320] font-mono">
              <p class="mb-2">Falha de Roteamento no Sandbox Google.</p>
              <p><strong>Ação:</strong> Remova o código final da URL manualmente.</p>
              <p class="mt-2 text-[10px] opacity-70">{{ initMessage() }}</p>
          </div>

          <button (click)="resetRoot()" 
                  class="w-full py-4 bg-[#2a2320] text-[#EAE0D5] font-bold uppercase cursor-pointer transition-all hover:bg-[#E86C26] hover:text-white shadow-lg">
              RESTAURAR PROTOCOLO
          </button>
          
          <div class="mt-4">
             <button (click)="retryInit()" class="text-xs text-[#2a2320] underline hover:text-[#E86C26]">Tentar reconectar sem reset</button>
          </div>
      </div>
  </div>
} @else {
  <!-- MAIN APP CONTENT - DESK ENVIRONMENT -->
  <div class="h-[100dvh] flex flex-col relative animate-[fadeIn_0.5s_ease-out] bg-[#050505] overflow-hidden">
    
    <!-- Desk Texture -->
    <div class="fixed inset-0 bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')] opacity-30 pointer-events-none z-0 mix-blend-overlay"></div>
    <div class="fixed inset-0 bg-gradient-to-b from-black via-transparent to-black opacity-80 pointer-events-none z-0"></div>

    <!-- TOAST NOTIFICATIONS (SWIPE ENABLED) -->
    <div class="fixed top-4 right-4 z-[99999] flex flex-col gap-2 pointer-events-none safe-area-pt">
      @for (toast of ui.toasts(); track toast.id) {
        <div (click)="ui.remove(toast.id)"
             (touchstart)="onToastTouchStart($event, toast.id)"
             (touchmove)="onToastTouchMove($event)"
             (touchend)="onToastTouchEnd()"
             class="pointer-events-auto cursor-pointer transform transition-transform duration-100 min-w-[300px] max-w-sm rounded-sm shadow-[5px_5px_15px_rgba(0,0,0,0.5)] overflow-hidden border-l-8 font-serif touch-pan-y"
             [style.transform]="activeToastSwipe()?.id === toast.id ? 'translateX(' + activeToastSwipe()!.currentOffset + 'px)' : 'translateX(0)'"
             [style.opacity]="getToastOpacity(toast.id)"
             [class.bg-[#EAE0D5]]="true"
             [class.border-green-600]="toast.type === 'SUCCESS'"
             [class.border-red-600]="toast.type === 'ERROR'"
             [class.border-blue-600]="toast.type === 'INFO'"
             [class.border-yellow-600]="toast.type === 'WARNING'">
           <div class="p-4 flex items-start gap-3 border border-[#2a2320]">
             <div class="flex-1"><p class="text-sm font-bold text-[#2a2320]">{{ toast.message }}</p></div>
           </div>
        </div>
      }
    </div>

    <!-- OFFLINE INDICATOR -->
    @if (!ui.isOnline()) {
      <div class="fixed top-0 left-0 right-0 bg-[#E86C26] text-[#2a2320] text-[10px] md:text-xs py-1 px-4 text-center z-[100] font-black uppercase tracking-widest flex justify-center items-center gap-2 shadow-lg border-b border-[#2a2320] safe-area-pt">
        ⚠️ MODO OFFLINE ATIVO - DADOS LOCAIS
      </div>
    }

    <!-- HEADER (LEATHER BINDER STYLE) - NOW CONTROLLED BY ISHEADERVISIBLE (Dashboard Only) -->
    @if (isHeaderVisible()) {
      <header class="bg-[#0a0a0a] text-white px-3 py-1.5 flex justify-between items-center z-40 border-b border-[#1a1a1a] w-full shrink-0 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1.5">
          <div class="flex flex-col">
              <span class="text-[10px] font-black tracking-[0.2em] text-[#E86C26] leading-tight">PROTOCOLO</span>
              <div class="flex items-center gap-1.5">
                  <span class="text-[10px] font-black tracking-[0.2em] text-gray-400 leading-tight">INTELIGENTE</span>
                  <div class="w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.8)]" [class.bg-green-500]="ui.isOnline()" [class.bg-[#E86C26]]="!ui.isOnline()"></div>
              </div>
              <span class="text-[7px] text-gray-600 uppercase tracking-widest mt-0.5">OS V{{ APP_VERSION_TAG }}</span>
          </div>
          <div class="flex items-center gap-2 md:gap-4 text-[10px] uppercase font-bold">
              <div class="flex items-center gap-1">
                  <span class="bg-[#eab308] text-black px-1 py-[1px] rounded-[2px] tracking-widest font-black text-[6px]">
                      {{ auth.activePlan() === 'PRO_INFINITY' ? 'PRO ∞' : auth.activePlan() }}
                  </span>
                  <span class="border border-[#eab308] text-[#eab308] px-1 py-[1px] rounded-[2px] tracking-widest font-black text-[6px]">
                      {{ auth.usageCount() }} / {{ auth.activePlan() === 'PRO_INFINITY' ? '∞' : auth.getPlanLimit() }}
                  </span>
              </div>
              
              <div class="flex flex-col items-end justify-center ml-1">
                  <span class="text-[7px] text-gray-400 tracking-widest font-bold leading-tight">OLÁ,</span>
                  <span class="text-white font-serif font-bold text-xs leading-tight">{{ auth.currentUser()?.nome?.split(' ')?.[0] || 'USUÁRIO' }}</span>
              </div>
              
              <button (click)="requestLogout()" class="flex items-center justify-center text-[#E86C26] hover:text-[#d55b1b] transition-colors ml-1 shrink-0" title="Sair do Sistema">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                  </svg>
              </button>
          </div>
      </header>
    }

    <!-- MAIN CONTENT (Desk Area) - White flash fixed by removing paper BG from here -->
    @if (db.initialized()) {
      <main class="flex-1 w-full relative transition-all duration-300 animate-[fadeIn_0.5s] z-10 overflow-hidden flex flex-col min-h-0">
          <!-- The container for router-outlet. Child components now provide their own "paper" background. -->
          <div class="flex-1 relative overflow-hidden flex flex-col w-full h-full">
              
              <!-- Content Router Area -->
              <div class="relative z-10 flex-1 flex flex-col overflow-hidden">
                  <!-- Simbiose Prediction Background Loader (Non-blocking) -->
                  @if (isRouteLoading()) {
                      <div class="absolute top-0 left-0 right-0 h-1 bg-[#E86C26]/20 z-50 overflow-hidden pointer-events-none">
                          <div class="h-full bg-[#E86C26] animate-[width_1s_infinite]"></div>
                      </div>
                  }
                  
                  <!-- Router Outlet Container (Always Visible for Background Loading Feel) -->
                  <div class="flex-1 flex flex-col overflow-hidden">
                      <router-outlet></router-outlet>
                  </div>
              </div>
          </div>
      </main>
    }
    
    <!-- UPDATE NOTIFICATION BANNER -->
    @if (updateAvailable()) {
      <div class="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[99999] bg-[#EAE0D5] border-4 border-[#E86C26] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.5)] flex flex-col gap-3 max-w-xs animate-[slideIn_0.3s] rotate-1 cursor-pointer" (click)="reloadApp()">
          <div class="flex items-start gap-3">
              <div class="bg-[#E86C26] text-white w-10 h-10 flex items-center justify-center font-black text-xl border-2 border-[#2a2320] shadow-sm">
                  ⚡
              </div>
              <div>
                  <h4 class="font-black text-[#2a2320] uppercase text-sm leading-tight">Atualização Disponível</h4>
                  <p class="text-[10px] text-[#5c4d46] font-bold leading-tight mt-1">Nova versão do sistema pronta.</p>
              </div>
          </div>
          <button (click)="reloadApp()" class="w-full py-3 bg-[#2a2320] text-[#EAE0D5] font-black uppercase text-xs tracking-widest hover:bg-[#E86C26] transition-colors shadow-md border-2 border-transparent hover:border-[#2a2320]">
              ATUALIZAR AGORA
          </button>
      </div>
    }
    
    <!-- GLOBAL FULLSCREEN IMAGE VIEWER (ECOSYSTEM WIDE) -->
    @if (ui.isImageViewerOpen() && ui.currentFullscreenImage()) {
      <div class="fixed inset-0 z-[100000] bg-black/95 flex items-center justify-center p-4 animate-[fadeIn_0.2s]" (click)="ui.closeImage()">
          <!-- Toolbar -->
          <button (click)="ui.closeImage()" class="absolute top-4 right-4 z-[100100] w-12 h-12 bg-white/10 text-white rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 hover:bg-white/20 active:scale-95 transition-all">
              <span class="text-2xl font-bold">✕</span>
          </button>

          <!-- Image -->
          <img [src]="'data:image/jpeg;base64,' + ui.currentFullscreenImage()" 
               class="max-w-full max-h-[90vh] object-contain shadow-2xl rounded-sm border border-white/10 select-none"
               (click)="$event.stopPropagation()">

          <!-- Caption/Footer -->
          <div class="absolute bottom-10 left-0 right-0 text-center pointer-events-none">
              <span class="inline-block bg-black/50 text-white px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest backdrop-blur-md border border-white/10 shadow-lg">
                  Visualização de Evidência (HD)
              </span>
          </div>
      </div>
    }
    
    <!-- RELEASE NOTES MODAL -->
    @if (showReleaseNotes()) {
        <div class="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm animate-[fadeIn_0.2s]">
            <div class="bg-[#EAE0D5] border-4 border-[#2a2320] w-full max-w-md shadow-2xl relative font-serif p-6 rounded-sm">
                <div class="flex items-center gap-3 mb-4 border-b-2 border-[#2a2320] pb-4">
                    <div class="bg-[#E86C26] text-white w-12 h-12 flex items-center justify-center font-black text-2xl border-2 border-[#2a2320] shadow-sm">
                        🚀
                    </div>
                    <div>
                        <h3 class="text-xl font-black text-[#2a2320] uppercase leading-tight">Atualização Concluída</h3>
                        <p class="text-xs text-[#5c4d46] font-bold uppercase tracking-wide">Versão {{ releaseNotesData().version }}</p>
                    </div>
                </div>
                
                <div class="mb-6 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                    <p class="text-sm text-[#2a2320] font-bold mb-3">O que há de novo nesta versão:</p>
                    <ul class="space-y-2">
                        @for (change of releaseNotesData().changes; track change) {
                            <li class="flex items-start gap-2 text-sm text-[#5c4d46]">
                                <span class="text-[#E86C26] font-bold mt-0.5">✓</span>
                                <span>{{ change }}</span>
                            </li>
                        }
                    </ul>
                </div>
                
                <div class="bg-green-900/10 border border-green-800/30 p-3 mb-6 rounded-sm">
                    <p class="text-xs text-green-800 font-bold text-center">
                        <span class="text-green-600 mr-1">🛡️</span> Seus dados locais foram preservados e o backup foi atualizado automaticamente.
                    </p>
                </div>
                
                <button (click)="closeReleaseNotes()" class="w-full py-3 bg-[#E86C26] text-white font-black uppercase text-sm shadow-md hover:bg-[#d55b1b] transition-colors border-2 border-[#2a2320]">
                    Continuar para o Sistema
                </button>
            </div>
        </div>
    }

    <!-- LOGOUT CONFIRMATION MODAL -->
    @if (showLogoutConfirmation()) {
        <div class="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm animate-[fadeIn_0.2s]">
            <div class="bg-[#EAE0D5] border-4 border-[#2a2320] w-full max-w-sm shadow-2xl relative font-serif p-6 text-center rounded-sm">
                <h3 class="text-xl font-black text-[#2a2320] uppercase mb-2">Encerrar Sessão?</h3>
                <p class="text-xs text-[#5c4d46] mb-6 font-bold uppercase tracking-wide">Você precisará digitar sua senha novamente para entrar.</p>
                
                <div class="flex gap-3">
                    <button (click)="cancelLogout()" class="flex-1 py-3 border-2 border-[#2a2320] text-[#2a2320] font-bold uppercase text-xs hover:bg-white transition-colors">
                        Cancelar
                    </button>
                    <button (click)="confirmLogout()" class="flex-1 py-3 bg-[#E86C26] text-white font-black uppercase text-xs shadow-md hover:bg-[#d55b1b] transition-colors border-2 border-[#2a2320]">
                        Sair Agora
                    </button>
                </div>
            </div>
        </div>
    }
  </div>
}

  <style>
  @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes width { 0% { width: 0; margin-left: 0; } 50% { width: 100%; margin-left: 0; } 100% { width: 0; margin-left: 100%; } }
  </style>
  `,
})
export class AppComponent implements OnDestroy, OnInit {
  auth = inject(AuthService);
  db = inject(DbService);
  ui = inject(UiService);
  protection = inject(DataProtectionService);
  quantumNet = inject(QuantumNetService); 
  gemini = inject(GeminiService); 
  deepSeek = inject(DeepSeekService); 
  sessionGuard = inject(SingleSessionService); 
  backPressService = inject(BackPressService);
  private router = inject(Router);
  
  // Update State
  updateAvailable = signal(false);
  showReleaseNotes = signal(false);
  releaseNotesData = signal<{version: string, changes: string[]}>({version: '', changes: []});
  
  // Initialization State
  initStatus = signal<'loading' | 'error' | 'ready'>('ready');
  initMessage = signal('');
  isRouteLoading = signal(false);
  
  // Logout Confirmation State
  showLogoutConfirmation = signal(false);
  
  // ROUTE TRACKING FOR HEADER VISIBILITY
  currentRoute = signal('');
  
  // TOAST SWIPE STATE
  activeToastSwipe = signal<{id: string, startX: number, currentOffset: number} | null>(null);
  
  // Image Viewer State (Local use mostly, but kept for compatibility)
  viewingImage = signal<string | null>(null);
  
  // Computed Header Visibility: EXCLUSIVE TO DASHBOARD
  isHeaderVisible = computed(() => {
      // 1. Verificações Básicas de Estado
      if (!this.db.initialized() || !this.auth.currentUser()) return false;
      
      // 2. Se o visualizador de imagens global estiver ativo, oculta tudo
      if (this.ui.isImageViewerOpen()) return false;

      // 3. Se estiver em Modo de Assinatura (Foco Total), oculta
      if (this.ui.isSignatureMode()) return false;

      // 4. REGRA DE OURO: O Header só aparece na rota '/dashboard' exata.
      // Em '/admin', '/login' ou qualquer outra, ele deve ser destruído.
      const route = this.currentRoute();
      return route === '/dashboard';
  });
  
  private restorationAttempted = false;
  private heartbeatInterval: NodeJS.Timeout | number | null = null;
  private safetyTimeout: NodeJS.Timeout | number | null = null;
  
  // REGRA DE OURO: VERSÃO ATUAL DO APP
  readonly APP_VERSION_TAG = '9.9.4';
  private readonly VERSION_KEY = 'simbiose_installed_version';
  
  private touchStartY = 0;

  constructor() {
    const location = inject(PlatformLocation) as PlatformLocation;
    const backPressService = inject(BackPressService);

    this.initializeSystem();
    this.currentRoute.set(this.router.url.split('?')[0]);
    
    // --- SAFETY UNLOCK ---
    this.safetyTimeout = setTimeout(() => {
        if (this.initStatus() === 'loading') {
            console.warn('[Safety] Forçando desbloqueio da UI por timeout.');
            this.db.initialized.set(true);
            this.initStatus.set('ready');
        }
    }, 4000);
    
    this.quantumNet.conectarRede();
    this.startGlobalHeartbeat();

    this.router.events.pipe(
      filter(event => 
        event instanceof NavigationStart || 
        event instanceof NavigationEnd || 
        event instanceof NavigationCancel || 
        event instanceof NavigationError
      )
    ).subscribe(event => {
      if (event instanceof NavigationStart) {
        if (event.url.includes('/package/new') || event.url.includes('/correspondence/new')) {
        } else {
          this.isRouteLoading.set(true);
        }
      } else if (event instanceof NavigationEnd) {
        this.isRouteLoading.set(false);
        // Atualiza a rota atual limpando query params para garantir comparação exata
        this.currentRoute.set(event.urlAfterRedirects.split('?')[0]);
      } else { 
        this.isRouteLoading.set(false);
      }
    });

    location.onPopState(() => {
      if (this.showLogoutConfirmation()) {
          this.cancelLogout();
          history.pushState(null, '');
          return;
      }
      if (this.viewingImage()) {
          this.closeImage();
          history.pushState(null, '');
          return;
      }
      if (backPressService.handleBackPress()) {
        history.pushState(null, '');
      }
    });

    effect(async () => {
        const dbReady = this.db.initialized();
        if (!dbReady || this.restorationAttempted) return;
        
        this.restorationAttempted = true; 
        if (this.safetyTimeout) clearTimeout(this.safetyTimeout);

        await this.handleVersionMigration();

        // PROTOCOLO DE RESSURREIÇÃO
        const hasData = this.db.porteiros().length > 0;
        if (!hasData) {
            try {
                console.log('[Auto-Restore] Banco vazio. Tentando restaurar backup automático...');
                const status = await this.deepSeek.tentarRessuscitacaoSistema();
                if (status === 'RESTORED') {
                    this.ui.show('Sistema restaurado automaticamente.', 'SUCCESS');
                }
            } catch(e) {
                console.warn('Auto-Restore warning:', e);
            }
        }
        
        await this.db.ensureSpecialUsers();
        
    }, { allowSignalWrites: true });

    effect(() => {
      if (this.db.initialized()) {
        this.initStatus.set('ready');
      }
    });

    // Handle hardware back button
    window.addEventListener('popstate', () => {
      if (this.backPressService.handleBackPress()) {
        // A handler consumed the back press (e.g., closed a modal).
        // Push the state back to prevent actual navigation.
        history.pushState(null, '', window.location.href);
      }
    });
  }

  onPullStart(event: TouchEvent) {
      if (window.scrollY === 0) {
          this.touchStartY = event.touches[0].clientY;
      }
  }

  async onPullEnd(event: TouchEvent) {
      if (this.touchStartY > 0) {
          const touchEndY = event.changedTouches[0].clientY;
          if (touchEndY - this.touchStartY > 150) { // Threshold
              this.isRouteLoading.set(true);
              await this.db.reloadSessionData();
              this.isRouteLoading.set(false);
              this.ui.show('Dados atualizados.', 'SUCCESS');
          }
          this.touchStartY = 0;
      }
  }

  ngOnInit() {
      // --- CLEANUP FINAL ---
      localStorage.removeItem('kiosk');
      localStorage.removeItem('simbiose_kiosk_active');
      
      try {
          if (document.exitFullscreen) {
              document.exitFullscreen().catch(() => {});
          } else if (typeof (document as any).webkitExitFullscreen === 'function') {
              (document as any).webkitExitFullscreen();
          }
      } catch { }
  }

  // --- TOAST SWIPE LOGIC ---
  onToastTouchStart(event: TouchEvent, id: string) {
      this.activeToastSwipe.set({
          id,
          startX: event.touches[0].clientX,
          currentOffset: 0
      });
  }

  onToastTouchMove(event: TouchEvent) {
      const state = this.activeToastSwipe();
      if (!state) return;
      const currentX = event.touches[0].clientX;
      const offset = currentX - state.startX;
      this.activeToastSwipe.set({ ...state, currentOffset: offset });
      if (Math.abs(offset) > 10) event.preventDefault();
  }

  onToastTouchEnd() {
      const state = this.activeToastSwipe();
      if (!state) return;
      if (Math.abs(state.currentOffset) > 100) {
          const direction = state.currentOffset > 0 ? 1 : -1;
          this.activeToastSwipe.set({ ...state, currentOffset: direction * 500 });
          setTimeout(() => {
              this.ui.remove(state.id);
              this.activeToastSwipe.set(null);
          }, 200);
      } else {
          this.activeToastSwipe.set(null);
      }
  }

  getToastOpacity(toastId: string): number {
      const state = this.activeToastSwipe();
      if (state && state.id === toastId) {
          return Math.max(0, 1 - (Math.abs(state.currentOffset) / 300));
      }
      return 1;
  }

  reloadApp() { window.location.reload(); }
  
  closeImage() {
      this.viewingImage.set(null);
  }
  
  private async handleVersionMigration() {
      const installedVersion = localStorage.getItem(this.VERSION_KEY);
      
      if (!installedVersion) {
          // Fresh install
          localStorage.setItem(this.VERSION_KEY, this.APP_VERSION_TAG);
          return;
      }

      if (installedVersion !== this.APP_VERSION_TAG) {
          console.log(`[Simbiose Update] Atualização detectada: ${installedVersion} -> ${this.APP_VERSION_TAG}`);
          if (this.db.porteiros().length > 0 || this.db.encomendas().length > 0) {
              await this.deepSeek.executarBackupTatico(true);
              this.ui.show('Aplicativo atualizado! Seus dados estão seguros.', 'SUCCESS');
          }
          
          // Define as notas de atualização
          this.releaseNotesData.set({
              version: this.APP_VERSION_TAG,
              changes: [
                  'Backup automático a cada ação (Auto-save).',
                  'Download automático de backup a cada 24 horas.',
                  'Restauração automática em segundo plano aprimorada.',
                  'Proteção de dados locais garantida durante atualizações.',
                  'Correções de estabilidade no modo offline.'
              ]
          });
          this.showReleaseNotes.set(true);
      }
  }

  closeReleaseNotes() {
      localStorage.setItem(this.VERSION_KEY, this.APP_VERSION_TAG);
      this.showReleaseNotes.set(false);
  }
  
  ngOnDestroy() {
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      if (this.safetyTimeout) clearTimeout(this.safetyTimeout);
  }
  
  private startGlobalHeartbeat() {
      const pulse = () => {
          if (this.quantumNet.status() === 'CONECTADO') {
              const user = this.auth.currentUser();
              const config = this.db.appConfig();
              const nodeIdentity = config.nomeCondominio || user?.nome || 'Node Desconhecido';
              this.quantumNet.broadcastTelemetry({
                  nodeName: nodeIdentity,
                  plan: this.auth.activePlan(),
                  usageCount: this.auth.usageCount(),
                  planLimit: this.auth.getPlanLimit(),
                  neuralWeight: this.gemini.calculateNeuralWeight()
              });
          }
      };
      setTimeout(pulse, 3000); 
      this.heartbeatInterval = setInterval(pulse, 30000);
  }

  async initializeSystem() {
    this.initializeNetworkStatus();
    console.log('%c Simbiose: Boot Sequence Started.', 'color: #ff6a00');
  }

  retryInit() { this.initStatus.set('loading'); this.initializeSystem(); }
  resetRoot() { window.location.hash = '/'; window.location.search = ''; window.location.pathname = '/'; window.location.reload(); }
  
  async initializeNetworkStatus() {
    const updateStatus = () => {
      const online = navigator.onLine;
      if (this.ui.isOnline() !== online) {
        this.ui.isOnline.set(online);
        if (online) this.ui.show('Conexão restabelecida.', 'SUCCESS');
        else this.ui.show('Você está OFFLINE.', 'WARNING');
      }
    };
    this.ui.isOnline.set(navigator.onLine);
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
  }
  
  requestLogout() { this.showLogoutConfirmation.set(true); }
  confirmLogout() { this.showLogoutConfirmation.set(false); this.auth.logout(); }
  cancelLogout() { this.showLogoutConfirmation.set(false); }
}
