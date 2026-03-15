
import { Component, inject, signal, computed, ViewChild, ElementRef, AfterViewInit, OnDestroy, effect, ChangeDetectionStrategy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule, PercentPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { DbService, Encomenda, Morador } from '../../services/db.service';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';
import { GeminiService, OcrExtractionResult, ImageQualityData } from '../../services/gemini.service';
import { PdfService } from '../../services/pdf.service';
import { BackPressService } from '../../services/core/back-press.service';
import { ExclusiveScannerService } from '../../services/exclusive-scanner.service';
import { ScannerDataService } from '../../services/scanner-data.service';
import { SimbioseHashService } from '../../services/core/simbiose-hash.service';

@Component({
  selector: 'app-package-form',
  standalone: true,
  imports: [CommonModule, FormsModule, PercentPipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './package-form.component.html'
})
export class PackageFormComponent implements AfterViewInit, OnDestroy {
  // Services
  private db = inject(DbService);
  auth = inject(AuthService); 
  private ui = inject(UiService);
  private gemini = inject(GeminiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private pdf = inject(PdfService);
  private backPress = inject(BackPressService);
  private ngZone = inject(NgZone);
  private scannerService = inject(ExclusiveScannerService);
  private scannerDataService: ScannerDataService = inject(ScannerDataService);
  private hashService = inject(SimbioseHashService);

  // State
  packageData = signal<Partial<Encomenda>>({
    status: 'PENDENTE',
    condicaoFisica: 'Intacta'
  });
  
  savedPackage = signal<Encomenda | null>(null);
  hasSharedProof = signal(false); 
  entryPdfBlob = signal<Blob | null>(null); 
  initialOcrResult = signal<OcrExtractionResult | null>(null);
  
  // NEW: Armazena o texto original lido pelo OCR para aprender variações (aliases) ao salvar
  originalScannedName = signal<string>('');
  
  // Layout State
  showCourierDetails = signal(false);

  // Scanner State
  isScannerOpen = signal(false);
  isProcessingScan = signal(false);
  isAutoCapturing = signal(false);
  isEngineTurboActive = signal(true); 
  autoCaptureStableCount = signal(0);
  autoStart = signal(false);
  
  isPrivacyViolation = signal(false);
  
  // STABILIZATION LOGIC (Hyper-Fast Mode: 0.6s)
  scanStabilizationProgress = signal(0);
  private detectionStartTime: number | null = null;
  
  // REGRA: Processamento (Tela Escura) mantido em 0.5s no modo turbo
  private readonly STANDARD_CAPTURE_DELAY_MS = 500; 
  
  isFlipSideMode = signal(false); 
  sideOneSummary = signal(''); 
  linkedPreLoteId = signal<string | null>(null); 
  
  private processTimeout: any = null;
  
  // TURBO MODE CONFIGURATION
  private readonly AUTO_CAPTURE_STABILITY_THRESHOLD = 1; 
  private readonly AUTO_FILL_CONFIDENCE_THRESHOLD = 0.60;
  private readonly FUZZY_MATCH_THRESHOLD = 0.75; 
  
  private lastFrameTime = 0;
  
  // PERFORMANCE TUNING: 
  private readonly SCAN_THROTTLE_MS = 90; 
  
  private previousImageData: ImageData | null = null;
  private motionScore = signal(0);

  // CANVAS DE PERFORMANCE (DOWNSAMPLING)
  private analysisCanvas: HTMLCanvasElement | null = null;
  private analysisCtx: CanvasRenderingContext2D | null = null;
  
  // BALANCED RESOLUTION: 540px width (qHD)
  private readonly ANALYSIS_WIDTH = 540; 

  scannerHeaderTitle = signal('Busca Neural');
  showFlash = signal(false);
  flashActive = signal(false);
  lockStatus = signal('SCANNING');
  showProcessingBreathPrompt = signal(false);
  showRapidinhoPrompt = signal(false);
  tempCapturedBase64 = signal<string | null>(null);
  qrCodeScanned = signal<string | null>(null);
  
  currentZoom = signal(1.0);
  maxZoom = signal(1.0);
  isZoomSupported = signal(false);
  
  ocrConfidences = signal<{ overall: number, destinatario: number, localizacao: number, transportadora: number, rastreio: number }>({ overall: 0, destinatario: 0, localizacao: 0, transportadora: 0, rastreio: 0 });
  
  scanStartTime = signal<number | null>(null);
  scanDuration = signal<number | null>(null);

  geminiStatus = computed(() => this.gemini.geminiApiStatus());

  // Prompts
  showSimplePackagePrompt = signal(false);
  simplePromptTitle = signal('');
  simplePromptMessage = signal('');
  simplePromptType = signal('MANUAL_REQUIRED');
  
  // LIMIT MODAL STATE (AD REWARD)
  showLimitModal = signal(false);
  isWatchingAd = signal(false);
  adTimer = signal(5);
  
  showSuccessModal = signal(false);
  showVioladaWarningModal = signal(false);
  tempVioladaCondition = signal<string | undefined>(undefined);
  showCameraPermissionPrompt = signal(false);

  showCancelModal = signal(false);
  cancelReason = signal('');
  cancelPassword = signal('');

  isPublicView = signal(false);
  isEditMode = signal(false);
  isCorrespondenceMode = signal(false);
  
  isReadOnly = computed(() => this.isPublicView() || this.isEditMode());
  currentUserFirstName = computed(() => this.auth.currentUser()?.nome?.split(' ')?.[0]);

  moradorSearchQuery = signal('');
  showDestinatarioManualModal = signal(false);

  carrierSearchQuery = signal('');
  showTransportadoraManualModal = signal(false);
  showInlineCarrierSuggestions = signal(false);

  relatedResidents = signal<Morador[]>([]);

  trackingCodeInput = signal('');
  showTrackingCodeManualModal = signal(false);

  totalScannedPackages = computed(() => this.db.encomendas().length);
  localPdfUrl = signal('');

  // Promo Logic
  totalLidas = signal(parseInt(localStorage.getItem('simbiose_promo_count') || '0'));
  mostrarPromo = signal(false);
  linkAtual = signal('');
  currentPromo = signal<any>(null); 
  
  // --- MODO TRIAGEM (BATCH MODE) ---
  isTriagemMode = signal(false);
  showTriagemSetupModal = signal(false);
  triagemBatch = signal<Encomenda[]>([]);
  triagemCourierName = signal('');
  triagemCourierPhone = signal('');
  triagemCourierCarrier = signal('');
  
  isTriagemSigning = signal(false);
  showBatchReview = signal(true); 
  
  showCourierSuggestions = signal(false);
  
  courierSuggestions = computed(() => {
      const query = this.triagemCourierName().trim().toUpperCase();
      if (query.length < 2) return [];
      const history = this.db.encomendas();
      const uniqueCouriers = new Map<string, string>(); 
      for (const item of history) {
          if (item.nomeEntregador) {
              const name = item.nomeEntregador.toUpperCase();
              if (name.includes(query) && !uniqueCouriers.has(name)) {
                  uniqueCouriers.set(name, item.telefoneEntregador || '');
              }
          }
      }
      return Array.from(uniqueCouriers.entries()).map(([name, phone]) => ({ name, phone })).slice(0, 5);
  });
  
  private pressTimer: any;
  isLongPressTriggered = false;
  isPressingButton = signal(false);
  isInitializingScanner = signal(false); 
  
  @ViewChild('signatureCanvas', { static: false }) signatureCanvas?: ElementRef<HTMLCanvasElement>;
  private isDrawing = false;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastX = 0;
  private lastY = 0;
  triagemSignatureBase64 = signal<string | null>(null);
  hasSignature = signal(false);
  private unlistenFunctions: (() => void)[] = [];
  
  private readonly promoLinks = [
    { url: 'https://go.hotmart.com/N104128946U?dp=1', intervalo: 15, titulo: 'Gestão PRO', descricao: '', imagem: '' },
    { url: 'https://go.hotmart.com/P104128647V?dp=1', intervalo: 5, titulo: 'Kit Start', descricao: '', imagem: '' }
  ];

  moradorSuggestions = computed<Morador[]>(() => {
    const query = this.normalizeString(this.moradorSearchQuery());
    if (query.length < 1) return [];
    return this.db.moradores().filter(morador => 
      this.normalizeString(morador.nome).includes(query) ||
      this.normalizeString(morador.bloco).includes(query) ||
      this.normalizeString(morador.apto).includes(query)
    );
  });

  carrierSuggestions = computed<string[]>(() => {
    const query = this.normalizeString(this.carrierSearchQuery());
    const sourceList = this.isCorrespondenceMode() ? this.db.senders() : this.db.carriers();
    if (query.length < 1) return sourceList.slice(0, 5); 
    return sourceList.filter(item => this.normalizeString(item).includes(query)).slice(0, 5); 
  });

  showSuggestions = computed(() => this.showDestinatarioManualModal() && this.moradorSuggestions().length > 0);
  showCarrierSuggestions = computed(() => this.showTransportadoraManualModal() && this.carrierSuggestions().length > 0);

  duplicatePackage = computed(() => {
      const code = this.packageData().codigoRastreio;
      if (!code || this.isCorrespondenceMode()) return null;
      const cleanCode = code.trim().toUpperCase();
      return this.db.encomendas().find(e => 
          (e.codigoRastreio || '').trim().toUpperCase() === cleanCode && 
          e.status !== 'CANCELADA' && 
          e.status !== 'PRE_LOTE'
      );
  });

  currentMoradorPhone = computed(() => {
      const pkg = this.savedPackage();
      if (!pkg) return '';
      const morador = this.db.moradores().find(m => m.bloco === pkg.bloco && m.apto === pkg.apto);
      return morador?.telefone || 'Sem Telefone';
  });

  residentValidation = computed(() => {
      const name = this.packageData().destinatarioNome;
      const bloco = this.packageData().bloco;
      const apto = this.packageData().apto;
      
      if (this.isReadOnly()) return { type: 'valid', message: null };
      
      const cleanName = this.normalizeString(name);
      const cleanBloco = this.normalizeString(bloco);
      const cleanApto = this.normalizeString(apto);
      
      if (!cleanName) return { type: 'valid', message: null };
      
      const allMoradores = this.db.moradores();
      
      // 1. Check if resident exists anywhere in the DB
      const matchingByName = allMoradores.filter(m => this.isSamePerson(cleanName, m.nome));
      
      if (matchingByName.length === 0 && cleanName.length >= 3) {
          if (cleanBloco && cleanApto) {
              const moradoresUnidade = allMoradores.filter(m => 
                  this.normalizeString(m.bloco) === cleanBloco && 
                  this.normalizeString(m.apto) === cleanApto
              );
              if (moradoresUnidade.length > 0) {
                  const principal = moradoresUnidade.find(m => m.isPrincipal) || moradoresUnidade[0];
                  return {
                      type: 'conflict',
                      message: `Morador não encontrado. A unidade ${bloco}-${apto} pertence a ${principal.nome}.`
                  };
              }
          }
          return { 
              type: 'not_found', 
              message: 'Morador não cadastrado no banco de dados.' 
          };
      }
      
      // 2. Check if the typed block/apt matches the resident's actual block/apt
      if (cleanBloco && cleanApto && matchingByName.length > 0) {
          const exactMatch = matchingByName.find(m => 
              this.normalizeString(m.bloco) === cleanBloco && 
              this.normalizeString(m.apto) === cleanApto
          );
          
          if (!exactMatch) {
              const actualAddress = matchingByName[0];
              return {
                  type: 'wrong_address',
                  message: `Atenção: ${actualAddress.nome} pertence ao Bloco ${actualAddress.bloco}, Apto ${actualAddress.apto}.`
              };
          }
      }
      
      return { type: 'valid', message: null };
  });

  @ViewChild('scannerVideo') scannerVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('scannerCanvas') scannerCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('qrCodeCanvas') qrCodeCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('shareableCard') shareableCard!: ElementRef<HTMLElement>;

  stream: MediaStream | null = null;
  private animationFrameId: number | null = null;

  constructor() {
    this.backPress.register(this.onBackPress);
    this.route.params.subscribe(p => { if(p['id']) this.loadPackage(p['id']); });
    this.route.queryParams.subscribe(params => {
      if (params['autoStart'] === 'true') {
        this.autoStart.set(true);
      }
    });
    this.analysisCanvas = document.createElement('canvas');
    this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
    
    this.router.events.pipe(
        filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
        const url = this.router.url;
        const user = this.auth.currentUser();
        
        this.isCorrespondenceMode.set(url.includes('/correspondence/'));
        
        if(url.includes('/package/') && !url.includes('/new') && !url.includes('/correspondence/')) {
            if(!user) this.isPublicView.set(true);
            else this.isEditMode.set(true);
        } else {
            this.isEditMode.set(false);
            this.isPublicView.set(false);
        }
    });

    effect(() => {
      const currentPackageTransportadora = this.packageData().transportadora;
      if (!this.showTransportadoraManualModal()) this.carrierSearchQuery.set(currentPackageTransportadora || '');
    }, { allowSignalWrites: true });

    effect(() => {
        const currentPackageDestinatario = this.packageData().destinatarioNome;
        if (!this.showDestinatarioManualModal()) this.moradorSearchQuery.set(currentPackageDestinatario || '');
    }, { allowSignalWrites: true });

    effect(() => {
        const currentTrackingCode = this.packageData().codigoRastreio;
        if (!this.showTrackingCodeManualModal()) this.trackingCodeInput.set(currentTrackingCode || '');
    }, { allowSignalWrites: true });

  }

  ngAfterViewInit() {
    this.checkScannedData();
    if (this.scannerDataService.autoOpenScanner()) {
      this.openScanner();
      this.scannerDataService.clearAutoOpen();
    }
    if (!this.isPublicView() && !this.isEditMode() && !this.route.snapshot.params['id']) {}
    if (this.autoStart()) {
      this.startScanner();
    }
  }

  private checkScannedData() {
    const data = this.scannerDataService.scannedData();
    if (data) {
      this.packageData.set({
        ...this.packageData(),
        destinatarioNome: data.destinatario,
        transportadora: data.transportadora,
        codigoRastreio: data.rawRastreio
      });
      this.scannerDataService.clearScannedData();
    }
  }

  ngOnDestroy() { 
    this.backPress.unregister(this.onBackPress);
    this.closeScanner(); 
    this.removeCanvasListeners();
    if (this.processTimeout) clearTimeout(this.processTimeout);
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.ui.isImageViewerOpen.set(false);
    this.analysisCanvas = null;
    this.analysisCtx = null;
  }

  // --- MISSING UTILITIES ---

  public normalizeString(str: string | undefined | null): string {
    return (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  }

  public isSamePerson(name1: string, name2: string): boolean {
    const n1 = this.normalizeString(name1);
    const n2 = this.normalizeString(name2);
    return n1 === n2 || n1.includes(n2) || n2.includes(n1);
  }

  public removeCanvasListeners() {
      this.unlistenFunctions.forEach(fn => fn());
      this.unlistenFunctions = [];
  }

  public viewPdf() {
      const url = this.localPdfUrl();
      if (url) {
          window.open(url, '_blank');
      } else {
          this.ui.show('Protocolo não disponível.', 'WARNING');
      }
  }
  
  // --- MODAL CLOSERS ---

  public closeLimitModal() { this.showLimitModal.set(false); }
  public closeImage() { this.ui.isImageViewerOpen.set(false); }
  public closeTriagemSetup() { this.showTriagemSetupModal.set(false); }
  public closeCancelModal() { this.showCancelModal.set(false); }
  public closeSuccessModal() { this.showSuccessModal.set(false); this.goBack(); }
  public closeSimplePackagePrompt() { this.showSimplePackagePrompt.set(false); }
  public closeDestinatarioManualModal() { this.showDestinatarioManualModal.set(false); }
  public closeTransportadoraManualModal() { this.showTransportadoraManualModal.set(false); }
  public closeTrackingCodeManualModal() { this.showTrackingCodeManualModal.set(false); }


  public startTriagem() {
      this.isTriagemMode.set(true);
      this.showTriagemSetupModal.set(true);
  }

  public isValidNew(): boolean {
      const d = this.packageData();
      const validation = this.residentValidation();
      const name = d.destinatarioNome ? d.destinatarioNome.trim() : '';
      return !!(name.length >= 3 && d.transportadora && d.bloco && d.apto && validation.type === 'valid');
  }

  public generateStandardTracking(): string {
      return `MANUAL-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;
  }

  // --- SCANNER LOGIC ---

  public closeScanner(retainTriagemState = false) {
      this.isScannerOpen.set(false);
      this.isProcessingScan.set(false);
      this.isInitializingScanner.set(false);
      this.isAutoCapturing.set(false);
      
      this.stopCameraStream(); // GARANTE LIMPEZA DE RECURSOS
      
      if (this.animationFrameId) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
      }
      
      this.flashActive.set(false); 
      
      if (!retainTriagemState) {
          this.scanStabilizationProgress.set(0);
          this.autoCaptureStableCount.set(0);
      }
  }
  
  // THERMAL PROTECTION METHOD
  private stopCameraStream() {
      if (this.stream) {
          this.stream.getTracks().forEach(track => {
              try {
                  track.stop();
              } catch(e) {}
          });
          this.stream = null;
      }
      // Force GPU Flush
      if (this.scannerVideo?.nativeElement) {
          this.scannerVideo.nativeElement.srcObject = null;
          this.scannerVideo.nativeElement.load(); 
      }
  }

  async startScanner() {
      console.log('startScanner called', { isScannerOpen: this.isScannerOpen(), isInitializingScanner: this.isInitializingScanner() });
      if (this.isScannerOpen() || this.isInitializingScanner()) return;
      
      this.isInitializingScanner.set(true);
      
      // REGRA DE RESFRIAMENTO: Assegura limpeza antes de reabrir
      this.stopCameraStream();
      await new Promise(resolve => setTimeout(resolve, 50)); 
      
      // REGRA MESTRA: Limpeza de Cache Automática ao iniciar o Scanner
      this.gemini.clearOcrCache();
      
      try {
          const constraints = {
              video: {
                  facingMode: 'environment',
                  width: { ideal: 1280 },
                  height: { ideal: 720 }
              }
          };
          
          this.stream = await navigator.mediaDevices.getUserMedia(constraints);
          this.isScannerOpen.set(true);
          
          // --- AUTO-FLASH LOGIC ---
          const track = this.stream.getVideoTracks()[0];
          if (track) {
              const capabilities = track.getCapabilities() as any;
              if (capabilities && capabilities.torch) {
                  this.showFlash.set(true);
                  this.flashActive.set(true);
                  track.applyConstraints({ advanced: [{ torch: true }] } as any).catch(err => {
                      console.warn('Auto-flash failed:', err);
                      this.flashActive.set(false);
                  });
              }
          }
          
          setTimeout(() => {
              if (this.scannerVideo && this.scannerVideo.nativeElement) {
                  const video = this.scannerVideo.nativeElement;
                  video.srcObject = this.stream;
                  video.play().catch(err => {
                      console.warn('Video playback interrupted (harmless):', err);
                  });
                  console.log('Calling processFrame from startScanner');
                  this.processFrame();
              }
          }, 100);

      } catch (e) {
          console.error('Camera failed', e);
          this.ui.show('Erro ao acessar a câmera.', 'ERROR');
          this.showCameraPermissionPrompt.set(true);
      } finally {
          this.isInitializingScanner.set(false);
      }
  }
  
  toggleFlash() {
      if (!this.stream) return;
      const track = this.stream.getVideoTracks()[0];
      if (!track) return;
      
      const newState = !this.flashActive();
      this.flashActive.set(newState);
      
      track.applyConstraints({
          advanced: [{ torch: newState }]
      } as any).catch(() => {
          this.ui.show('Flash indisponível.', 'WARNING');
          this.flashActive.set(!newState); 
      });
  }

  private processFrame() {
      console.log('processFrame called', { isProcessingScan: this.isProcessingScan(), isScannerOpen: this.isScannerOpen(), readyState: this.scannerVideo?.nativeElement?.readyState });
      // Immediate exit if we started processing
      if (this.isProcessingScan()) return;

      if (!this.isScannerOpen() || !this.scannerVideo?.nativeElement || !this.scannerCanvas?.nativeElement) {
          this.animationFrameId = requestAnimationFrame(() => this.processFrame());
          return;
      }
      
      const video = this.scannerVideo.nativeElement;
      const canvas = this.scannerCanvas.nativeElement;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
          console.log('Video has enough data');
          const now = Date.now();
          if (now - this.lastFrameTime > this.SCAN_THROTTLE_MS && !this.isProcessingScan()) {
              this.lastFrameTime = now;
              
              const scale = Math.min(1, this.ANALYSIS_WIDTH / video.videoWidth);
              const w = video.videoWidth * scale;
              const h = video.videoHeight * scale;

              canvas.width = w;
              canvas.height = h;
              
              ctx.drawImage(video, 0, 0, w, h);
              console.log('Calling detectAndCapture');
              this.detectAndCapture(canvas);
          }
      } else {
          console.log('Video not ready yet');
      }
      
      this.animationFrameId = requestAnimationFrame(() => this.processFrame());
  }

  private async detectAndCapture(canvas: HTMLCanvasElement) {
      if (this.isAutoCapturing() || this.isProcessingScan()) return;
      
      // REGRA: "0.6 segundos para a tela ficar escura"
      // Aumenta ~5.6% por frame no modo turbo (a 60fps, ~18 frames = ~0.3s).
      const increment = this.isEngineTurboActive() ? 5.6 : 2.8;
      this.scanStabilizationProgress.update(v => Math.min(100, v + increment)); 

      if (this.scanStabilizationProgress() >= 100) {
          this.isAutoCapturing.set(true);
          this.ui.vibrate(50);
          
          const base64 = canvas.toDataURL('image/jpeg', 0.8);
          await this.processCapturedImage(base64);
      }
  }

  async processCapturedImage(base64: string) {
      // 1. THERMAL CRITICAL FIX: STOP CAMERA BEFORE ANYTHING ELSE
      // Desliga o feed de vídeo IMEDIATAMENTE para matar o consumo de GPU/CPU
      // Isso previne o desligamento térmico quando carregando.
      this.stopCameraStream(); 
      
      // 2. ATIVA O BLACKOUT VISUAL
      this.isProcessingScan.set(true);
      
      this.ui.playTone('SHUTTER');
      this.packageData.update(d => ({ ...d, fotoBase64: base64.split(',')[1] })); 

      // 3. COOL-DOWN GAP (Pausa Tática)
      // Dá 50ms para o browser renderizar a tela preta e a GPU esfriar antes de chamar a IA.
      await new Promise(resolve => setTimeout(resolve, 50));

      this.showProcessingBreathPrompt.set(true);

      try {
          const allMoradores = this.db.moradores();
          const learnedCarriers = this.db.carriers();

          // REGRA: "1,5 segundos na tela escura"
          // O processamento ocorre em paralelo, mas a UI respeita o tempo mínimo.
          const [result] = await Promise.all([
              this.gemini.extractTextFromLabel(
                  base64.split(',')[1], 
                  allMoradores, 
                  learnedCarriers
              ),
              new Promise(resolve => setTimeout(resolve, this.STANDARD_CAPTURE_DELAY_MS))
          ]);
          
          // SNIPER MODE: Armazena o texto original lido
          this.originalScannedName.set(result.destinatario);

          this.ngZone.run(() => {
              const morador = result.matchedMoradorId ? allMoradores.find(m => m.id === result.matchedMoradorId) : null;
              
              if (!morador) {
                  this.ui.show('Morador não identificado no banco de dados.', 'ERROR');
                  return;
              }
              
              this.packageData.update(d => ({
                  ...d,
                  destinatarioNome: result.destinatario || d.destinatarioNome,
                  transportadora: result.transportadora || d.transportadora,
                  codigoRastreio: result.rawRastreio || d.codigoRastreio,
                  condicaoFisica: (result.condicaoVisual as any) || d.condicaoFisica
              }));
              
              this.updateModel('bloco', morador.bloco);
              this.updateModel('apto', morador.apto);
              if (result.wasAutoCorrected) {
                  this.ui.show(`Identificado: ${morador.nome}`, 'SUCCESS');
              }
              
              this.ocrConfidences.set({
                  overall: result.confianca,
                  destinatario: result.destinatarioConfidence || 0,
                  localizacao: result.localizacaoConfidence || 0,
                  transportadora: result.transportadoraConfidence || 0,
                  rastreio: result.rastreioConfidence || 0
              });
              
              if (result.privacyBlocked) {
                  this.isPrivacyViolation.set(true);
                  this.ui.show('Bloqueio de Privacidade: Rosto Humano Detectado.', 'ERROR');
              }
          });

      } catch (e) {
          console.error('Scan processing error', e);
          this.ui.show('Falha na leitura. Tente novamente.', 'ERROR');
      } finally {
          this.showProcessingBreathPrompt.set(false);
          this.closeScanner(); // Garante reset completo do estado
      }
  }

  private onBackPress = (): boolean => {
    if (this.showLimitModal()) { if (!this.isWatchingAd()) { this.closeLimitModal(); } return true; }
    if (this.mostrarPromo()) return true; 
    if (this.ui.isImageViewerOpen()) { this.closeImage(); return true; }
    if (this.showTriagemSetupModal()) { this.closeTriagemSetup(); return true; }
    if (this.isTriagemSigning()) { this.isTriagemSigning.set(false); return true; }
    if (this.showInlineCarrierSuggestions()) { this.showInlineCarrierSuggestions.set(false); return true; }
    if (this.isTriagemMode() && this.triagemBatch().length > 0) { if(confirm('Sair do Modo Triagem? Os itens não salvos serão descartados.')) { this.closeScanner(); return true; } return true; }
    if (this.isScannerOpen()) { this.closeScanner(); return true; }
    if (this.showCancelModal()) { this.closeCancelModal(); return true; }
    if (this.showSuccessModal()) {
         if (!this.hasSharedProof()) { this.ui.show('⚠️ Obrigatório: Envie o comprovante para finalizar.', 'WARNING'); this.ui.vibrate([100, 50, 100]); return true; }
         this.closeSuccessModal();
         return true;
    }
    if (this.showSimplePackagePrompt()) { this.closeSimplePackagePrompt(); return true; }
    if (this.showDestinatarioManualModal()) { this.closeDestinatarioManualModal(); return true; }
    if (this.showTransportadoraManualModal()) { this.closeTransportadoraManualModal(); return true; }
    if (this.showTrackingCodeManualModal()) { this.closeTrackingCodeManualModal(); return true; }
    if (this.showCameraPermissionPrompt()) { this.cancelCameraPermission(); return true; }
    this.goBack();
    return true; 
  };

  loadPackage(id: string) {
     this.db.loadFullEncomenda(id).then(e => { if(e) this.packageData.set(e); });
  }
  
  goBack() { 
      this.router.navigate(['/dashboard'], { replaceUrl: true }); 
  }
  
  toggleCourierDetails() { this.showCourierDetails.update(v => !v); }

  startPress() { if (this.isReadOnly()) return; this.isLongPressTriggered = false; this.isPressingButton.set(true); this.pressTimer = setTimeout(() => { this.isLongPressTriggered = true; this.isPressingButton.set(false); this.ui.vibrate(200); this.startTriagem(); }, 1700); }
  endPress() { if (this.pressTimer) clearTimeout(this.pressTimer); this.isPressingButton.set(false); this.isLongPressTriggered = false; }
  cancelPress() { if (this.pressTimer) clearTimeout(this.pressTimer); this.isPressingButton.set(false); this.isLongPressTriggered = false; }

  openScanner() { 
      const permissionChoiceMade = sessionStorage.getItem('camera_permission_choice_made'); 
      // SNIPER MODE: Limpa o cache sempre que o usuário inicia uma nova leitura manual
      this.gemini.clearOcrCache(); 
      this.previousImageData = null; 
      
      if (permissionChoiceMade) this.startScanner(); 
      else this.showCameraPermissionPrompt.set(true); 
  }
  
  proceedWithCamera() { sessionStorage.setItem('camera_permission_choice_made', 'true'); this.showCameraPermissionPrompt.set(false); this.startScanner(); }
  cancelCameraPermission() { sessionStorage.setItem('camera_permission_choice_made', 'true'); this.showCameraPermissionPrompt.set(false); }

  async saveNew() {
      if (this.isPrivacyViolation()) { this.ui.show('🚫 PRIVACIDADE: FOTO DESCARTADA. NÃO É PERMITIDO REGISTRAR HUMANOS.', 'ERROR'); return; }
      const d = this.packageData();
      const name = d.destinatarioNome ? d.destinatarioNome.trim().toUpperCase() : '';
      const invalidNames = ['N/A', 'NA', 'N.A.', 'NÃO IDENTIFICADO', 'NAO IDENTIFICADO', 'SEM NOME', 'DESCONHECIDO', 'ILEGIVEL', 'ILEGÍVEL'];
      if (name.length < 3 || invalidNames.includes(name)) { this.ui.show('⚠️ Destinatário Inválido: "N/A" não permitido. Identifique o morador.', 'ERROR'); this.ui.vibrate([100, 100, 100]); return; }
      if(!this.isValidNew()) {
          const validation = this.residentValidation();
          if (validation.type !== 'valid' && validation.message) {
              this.ui.show(validation.message, 'ERROR');
          }
          return;
      }
      
      this.ui.show('Validando...', 'INFO');
      const usageCheck = await this.auth.reportUsage(1);
      if (!usageCheck.ok) {
          if (this.auth.activePlan() === 'START' && usageCheck.code === 'LIMIT_REACHED_START') { this.showLimitModal.set(true); this.ui.playTone('URGENT'); return; }
          this.ui.show(usageCheck.message || 'Erro.', 'ERROR'); return; 
      }
      this.ui.show('Salvando...', 'SUCCESS');
      
      let finalTrackingCode = d.codigoRastreio;
      if (!this.isCorrespondenceMode() && (!finalTrackingCode || finalTrackingCode.trim() === '')) { finalTrackingCode = this.generateStandardTracking(); }

      const newItem: Encomenda = {
          id: this.isEditMode() && d.id ? d.id : crypto.randomUUID(),
          destinatarioNome: d.destinatarioNome!,
          bloco: d.bloco,
          apto: d.apto,
          transportadora: d.transportadora,
          codigoRastreio: finalTrackingCode,
          condicaoFisica: d.condicaoFisica,
          dataEntrada: d.dataEntrada || new Date().toISOString(),
          status: (d.status as any) || 'PENDENTE',
          porteiroEntradaId: this.isEditMode() && d.porteiroEntradaId ? d.porteiroEntradaId : (this.auth.currentUser()?.id || 'admin'),
          fotoBase64: d.fotoBase64,
          assinaturaBase64: d.assinaturaBase64,
          observacoes: d.observacoes,
          nomeEntregador: d.nomeEntregador,
          telefoneEntregador: d.telefoneEntregador,
          ...((this.isEditMode() && this.packageData().id) ? {} : {})
      };

      try {
          if (this.isEditMode()) {
              await this.db.updateEncomenda(newItem.id, newItem);
          } else {
              await this.db.addEncomenda(newItem);
              if (this.linkedPreLoteId()) { await this.db.deleteItem('encomendas', this.linkedPreLoteId()!); this.ui.show('Item de lote convertido com sucesso.', 'SUCCESS'); }
              
              // LEARN: Passamos o nome original lido pelo OCR para o sistema aprender alias (correções)
              this.gemini.learnFromPackage(newItem, this.originalScannedName());
              
              this.gemini.registrarLeituraValida();
          }

          this.savedPackage.set(newItem);
          
          const currentUser = this.auth.currentUser();
          if (currentUser) {
              const { blob, url } = await this.pdf.generateEntryProtocol(newItem, currentUser);
              this.entryPdfBlob.set(blob);
              this.localPdfUrl.set(url);
          }
          
          this.showSuccessModal.set(true);
          this.ui.playTone('SUCCESS');

      } catch(e) {
          console.error(e);
          this.ui.show('Erro ao salvar no banco de dados.', 'ERROR');
      }
  }

  async shareEntryProof() {
      const blob = this.entryPdfBlob();
      const pkg = this.savedPackage();
      
      if (!blob || !pkg) return;
      this.hasSharedProof.set(true);

      const text = `*PROTOCOLO DE ENTRADA* 📦\n\nOlá ${pkg.destinatarioNome},\nChegou uma encomenda para você!\n\n📍 Unidade: ${pkg.bloco}-${pkg.apto}\n🚚 Via: ${pkg.transportadora}\n📅 ${new Date(pkg.dataEntrada).toLocaleString()}`;

      if (navigator.share && navigator.canShare) {
          const file = new File([blob], `Protocolo_${pkg.id.substring(0,6)}.pdf`, { type: 'application/pdf' });
          const shareData = { files: [file], title: 'Comprovante de Chegada', text: text };
          try {
              if (navigator.canShare(shareData)) { await navigator.share(shareData); return; }
          } catch (e) { console.warn('Native share failed or cancelled', e); }
      }

      this.ui.show('PDF salvo. Compartilhe manualmente se necessário.', 'INFO');
      let phone = '';
      const resident = this.db.moradores().find(m => 
          this.normalizeString(m.bloco) === this.normalizeString(pkg.bloco || '') && 
          this.normalizeString(m.apto) === this.normalizeString(pkg.apto || '') &&
          (m.isPrincipal || this.normalizeString(m.nome) === this.normalizeString(pkg.destinatarioNome))
      );
      if (resident && resident.telefone) {
          phone = resident.telefone.replace(/\D/g, '');
          if (phone.length >= 8 && !phone.startsWith('55')) phone = '55' + phone;
      }
      const waUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(waUrl, '_blank');
      const pdfUrl = this.localPdfUrl();
      if(pdfUrl) window.open(pdfUrl, '_blank');
  }

  // --- TRIAGEM MODE HELPERS ---
  onCourierNameInput() {
      this.showCourierSuggestions.set(true);
  }

  selectCourierSuggestion(c: {name: string, phone: string}) {
      this.triagemCourierName.set(c.name);
      this.triagemCourierPhone.set(c.phone);
      this.showCourierSuggestions.set(false);
  }

  confirmTriagemSetup() {
      if(!this.triagemCourierName().trim()) {
          this.ui.show('Informe o nome do entregador.', 'WARNING');
          return;
      }
      this.showTriagemSetupModal.set(false);
      this.triagemBatch.set([]);
      this.openScanner();
  }
  
  finishTriagemBatch() {
      if(this.triagemBatch().length === 0) {
          this.ui.show('Lote vazio.', 'WARNING');
          return;
      }
      this.closeScanner(true);
      this.showBatchReview.set(true);
      this.isTriagemSigning.set(true);
  }
  
  confirmBatchReview() {
      this.showBatchReview.set(false);
      setTimeout(() => this.initSignatureCanvas(), 100);
  }
  
  clearTriagemSignature() {
      if(this.ctx && this.signatureCanvas) {
          const c = this.signatureCanvas.nativeElement;
          this.ctx.clearRect(0,0,c.width, c.height);
      }
  }
  
  initSignatureCanvas() {
      const canvas = this.signatureCanvas?.nativeElement;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      
      this.ctx = canvas.getContext('2d');
      if (this.ctx) {
          this.ctx.scale(dpr, dpr);
          this.ctx.lineWidth = 3;
          this.ctx.lineCap = 'round';
          this.ctx.lineJoin = 'round';
          this.ctx.strokeStyle = '#000';
          
          const startDraw = (e: any) => { if(e.cancelable) e.preventDefault(); this.isDrawing = true; this.ctx?.beginPath(); const pos = getPos(e); this.lastX = pos.x; this.lastY = pos.y; };
          const draw = (e: any) => { if(!this.isDrawing || !this.ctx) return; if(e.cancelable) e.preventDefault(); const pos = getPos(e); this.ctx.beginPath(); this.ctx.moveTo(this.lastX, this.lastY); this.ctx.lineTo(pos.x, pos.y); this.ctx.stroke(); this.lastX = pos.x; this.lastY = pos.y; };
          const endDraw = () => { this.isDrawing = false; };
          const getPos = (e: any) => { const r = canvas.getBoundingClientRect(); const cx = e.touches ? e.touches[0].clientX : e.clientX; const cy = e.touches ? e.touches[0].clientY : e.clientY; return { x: cx - r.left, y: cy - r.top }; };

          canvas.addEventListener('mousedown', startDraw);
          canvas.addEventListener('mousemove', draw);
          canvas.addEventListener('mouseup', endDraw);
          canvas.addEventListener('touchstart', startDraw, {passive: false});
          canvas.addEventListener('touchmove', draw, {passive: false});
          canvas.addEventListener('touchend', endDraw);
      }
  }

  async saveTriagemBatch() {
      const canvas = this.signatureCanvas?.nativeElement;
      if (!canvas) return;
      const sig = canvas.toDataURL('image/png').split(',')[1];
      
      const now = new Date().toISOString();
      const items: Encomenda[] = [];
      const porteiro = this.auth.currentUser();
      
      this.ui.show('Processando Lote...', 'INFO');
      
      for(const temp of this.triagemBatch()) {
          const real: Encomenda = {
              ...temp,
              id: crypto.randomUUID(),
              dataEntrada: now,
              status: 'PENDENTE',
              condicaoFisica: 'Intacta',
              porteiroEntradaId: porteiro?.id || 'admin',
              nomeEntregador: this.triagemCourierName(),
              telefoneEntregador: this.triagemCourierPhone(),
              transportadora: this.triagemCourierCarrier() || temp.transportadora || 'MANUAL',
              assinaturaBase64: sig,
          };
          await this.db.addEncomenda(real);
          items.push(real);
          this.gemini.learnFromPackage(real);
      }
      
      this.ui.show(`${items.length} volumes registrados!`, 'SUCCESS');
      this.ui.playTone('SUCCESS');
      this.isTriagemSigning.set(false);
      this.isTriagemMode.set(false);
      
      this.goBack();
  }

  // --- TEMPLATE HELPERS ---

  onAddressChange(field: string, value: any) {
    this.updateModel(field, value);
    
    const d = this.packageData();
    const bloco = field === 'bloco' ? value : d.bloco;
    const apto = field === 'apto' ? value : d.apto;
    
    if (bloco && apto) {
        const moradores = this.db.moradores().filter(m => 
            this.normalizeString(m.bloco) === this.normalizeString(bloco) && 
            this.normalizeString(m.apto) === this.normalizeString(apto)
        );
        
        if (moradores.length === 1) {
            this.updateModel('destinatarioNome', moradores[0].nome);
            this.relatedResidents.set([]);
        } else if (moradores.length > 1) {
            this.relatedResidents.set(moradores);
        } else {
            this.relatedResidents.set([]);
        }
    } else {
        this.relatedResidents.set([]);
    }
  }

  updateModel(field: string, value: any) {
    this.packageData.update(d => ({ ...d, [field]: value }));
  }

  openImage(base64: string) {
    this.ui.openImage(base64);
  }

  removeFoto() {
    this.packageData.update(d => ({ ...d, fotoBase64: undefined }));
  }

  onTransportadoraInput(value: string) {
    this.updateModel('transportadora', value);
    this.carrierSearchQuery.set(value);
    this.showInlineCarrierSuggestions.set(true);
  }

  onTransportadoraBlur() {
    setTimeout(() => {
        this.showInlineCarrierSuggestions.set(false);
    }, 200);
  }

  selectInlineCarrier(carrier: string) {
    this.updateModel('transportadora', carrier);
    this.showInlineCarrierSuggestions.set(false);
  }

  selectRelatedResident(resident: Morador) {
      this.updateModel('destinatarioNome', resident.nome);
      this.updateModel('bloco', resident.bloco);
      this.updateModel('apto', resident.apto);
  }

  openCancelModal() {
      this.showCancelModal.set(true);
  }

  async confirmCancelPackage() {
      const reason = this.cancelReason().trim();
      const pwd = this.cancelPassword().trim();
      
      if (!reason) {
          this.ui.show('Informe o motivo.', 'WARNING');
          return;
      }
      
      if (pwd.length < 3) {
           this.ui.show('Confirme sua senha.', 'WARNING');
           return;
      }

      const user = this.auth.currentUser();
      this.ui.show('Cancelando...', 'INFO');
      
      try {
          const pkg = this.packageData();
          if (pkg.id) {
              const now = new Date().toISOString();
              const update: Partial<Encomenda> = {
                  status: 'CANCELADA',
                  observacoes: `CANCELADO: ${reason} (Por ${user?.nome || 'Admin'})`,
                  porteiroSaidaId: user?.id,
                  dataSaida: now
              };
              await this.db.updateEncomenda(pkg.id, update);
              
              const fullPkg: Encomenda = { ...pkg as Encomenda, ...update };
              const porteiro = this.auth.currentUser();
              if (porteiro) {
                  await this.pdf.generateCancellationProof(fullPkg, porteiro);
              }
              
              this.ui.show('Registro cancelado.', 'SUCCESS');
              this.closeCancelModal();
              this.goBack();
          }
      } catch (e) {
          this.ui.show('Erro ao cancelar.', 'ERROR');
      }
  }
}
