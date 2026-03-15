import { Component, inject, signal, ViewChild, ElementRef, AfterViewInit, OnDestroy, Output, EventEmitter, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ExclusiveScannerService } from '../../services/exclusive-scanner.service';
import { UiService } from '../../services/ui.service';
import { GeminiService, OcrExtractionResult } from '../../services/gemini.service';
import { DbService } from '../../services/db.service';
import { ScannerDataService } from '../../services/scanner-data.service';

@Component({
  selector: 'app-scanner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scanner.component.html'
})
export class ScannerComponent implements AfterViewInit, OnDestroy {
  @Output() close = new EventEmitter<void>();
  
  private scannerService = inject(ExclusiveScannerService);
  private ui = inject(UiService);
  private gemini = inject(GeminiService);
  private db = inject(DbService);
  private ngZone = inject(NgZone);
  private router = inject(Router);
  private scannerDataService = inject(ScannerDataService);

  @ViewChild('scannerVideo') scannerVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('scannerCanvas') scannerCanvas!: ElementRef<HTMLCanvasElement>;

  isScannerOpen = signal(false);
  isProcessingScan = signal(false);
  flashActive = signal(false);
  showFlash = signal(false);
  stream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  private readonly SCAN_THROTTLE_MS = 60; // Reduced from 90 to 60 for more agility
  private readonly ANALYSIS_WIDTH = 640; // Reduced resolution to prevent memory/thermal crashes

  ngAfterViewInit() {
    this.startScanner();
  }

  ngOnDestroy() {
    this.closeScanner();
  }

  async startScanner() {
    try {
      const constraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 }, // Keep camera resolution high for clarity
          height: { ideal: 720 }
        }
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.isScannerOpen.set(true);
      
      const video = this.scannerVideo.nativeElement;
      video.srcObject = this.stream;
      video.play();
      
      this.processFrame();
    } catch (e) {
      console.error('Camera failed', e);
      this.ui.show('Erro ao acessar a câmera.', 'ERROR');
      this.close.emit();
    }
  }

  closeScanner() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.scannerVideo?.nativeElement) {
      this.scannerVideo.nativeElement.srcObject = null;
      this.scannerVideo.nativeElement.load();
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isScannerOpen.set(false);
    this.close.emit();
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
      if (this.isProcessingScan()) return;

      if (!this.isScannerOpen() || !this.scannerVideo?.nativeElement || !this.scannerCanvas?.nativeElement) {
          this.animationFrameId = requestAnimationFrame(() => this.processFrame());
          return;
      }
      
      const video = this.scannerVideo.nativeElement;
      const canvas = this.scannerCanvas.nativeElement;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
          const now = Date.now();
          if (now - this.lastFrameTime > this.SCAN_THROTTLE_MS && !this.isProcessingScan()) {
              this.lastFrameTime = now;
              
              // Scale down for processing to prevent thermal/memory crashes
              const scale = Math.min(1, this.ANALYSIS_WIDTH / video.videoWidth);
              const w = video.videoWidth * scale;
              const h = video.videoHeight * scale;

              canvas.width = w;
              canvas.height = h;
              
              ctx.drawImage(video, 0, 0, w, h);
              this.detectAndCapture(canvas);
          }
      }
      
      this.animationFrameId = requestAnimationFrame(() => this.processFrame());
  }

  private async detectAndCapture(canvas: HTMLCanvasElement) {
      if (this.isProcessingScan()) return;
      this.isProcessingScan.set(true);
      
      // Stop video playback during heavy processing to prevent GPU/Thermal crash on chargers
      if (this.scannerVideo?.nativeElement) {
          this.scannerVideo.nativeElement.pause();
      }
      
      try {
          const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
          
          // Using ExclusiveScannerService logic
          const result = await this.scannerService.processScan(base64);
          
          if (result.status === 'valid' || result.status === 'fallback') {
              this.ui.show(`Detectado: ${result.destinatario}`, 'SUCCESS');
              
              // Map ScanResult to OcrExtractionResult
              const ocrResult: OcrExtractionResult = {
                destinatario: result.destinatario,
                localizacao: '', // Not provided by ExclusiveScannerService
                transportadora: result.transportadora,
                confianca: result.confidence / 100,
                rawRastreio: undefined // Not provided by ExclusiveScannerService
              };

              this.scannerDataService.setScannedData(ocrResult);
              this.scannerDataService.triggerAutoOpen();
              this.closeScanner();
              this.router.navigate(['/package/new']);
          } else {
              this.isProcessingScan.set(false);
              if (this.scannerVideo?.nativeElement) {
                  this.scannerVideo.nativeElement.play().catch(() => {});
              }
          }
      } catch (e) {
          console.error('Scan failed', e);
          this.isProcessingScan.set(false);
          if (this.scannerVideo?.nativeElement) {
              this.scannerVideo.nativeElement.play().catch(() => {});
          }
      }
  }
}
