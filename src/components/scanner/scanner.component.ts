import {
  Component,
  inject,
  signal,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExclusiveScannerService } from '../../services/exclusive-scanner.service';

/* ============================================================
   FRAME DIFFERENCE ENGINE
   Evita OCR em frames iguais
============================================================ */

class FrameDiffEngine {

  private lastHash = '';

  computeHash(canvas: HTMLCanvasElement): string {

    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, 32, 32).data;

    let hash = 0;

    for (let i = 0; i < img.length; i += 16) {
      hash += img[i];
    }

    return hash.toString(16);
  }

  shouldProcess(canvas: HTMLCanvasElement) {

    const hash = this.computeHash(canvas);

    if (hash === this.lastHash) return false;

    this.lastHash = hash;
    return true;
  }
}

/* ============================================================
   AUTO LABEL CROP (detecção de etiqueta)
============================================================ */

function autoCropLabel(video: HTMLVideoElement): HTMLCanvasElement {

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let minX = 99999, minY = 99999, maxX = 0, maxY = 0;

  for (let i = 0; i < img.data.length; i += 4) {

    const brightness =
      (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;

    if (brightness > 210) {

      const px = (i / 4) % canvas.width;
      const py = Math.floor((i / 4) / canvas.width);

      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }

  const crop = document.createElement('canvas');

  crop.width = Math.max(200, maxX - minX);
  crop.height = Math.max(200, maxY - minY);

  crop.getContext('2d')!.drawImage(
    canvas,
    minX,
    minY,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );

  return crop;
}

/* ============================================================
   SCANNER COMPONENT — V3
============================================================ */

@Component({
  selector: 'app-scanner',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="fixed inset-0 z-[5000] bg-black flex flex-col">

    <video #scannerVideo
      class="absolute inset-0 w-full h-full object-cover"
      playsinline muted>
    </video>

    <button
      (click)="closeScanner()"
      class="absolute top-4 right-4 z-10 p-4 text-white">
      FECHAR
    </button>

  </div>
  `
})
export class ScannerComponent
  implements AfterViewInit, OnDestroy {

  @ViewChild('scannerVideo')
  scannerVideo!: ElementRef<HTMLVideoElement>;

  private scannerService = inject(ExclusiveScannerService);

  private stream: MediaStream | null = null;
  private isProcessing = signal(false);

  private diffEngine = new FrameDiffEngine();

  /* ---------------- INIT CAMERA ---------------- */

  async ngAfterViewInit() {

    this.stream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

    const video = this.scannerVideo.nativeElement;

    video.srcObject = this.stream;
    await video.play();

    this.processFrame();
  }

  /* ---------------- FRAME LOOP ---------------- */

  private processFrame() {

    if (this.isProcessing()) return;

    const video = this.scannerVideo.nativeElement;

    const cropCanvas = autoCropLabel(video);

    if (!this.diffEngine.shouldProcess(cropCanvas)) {
      requestAnimationFrame(() => this.processFrame());
      return;
    }

    this.isProcessing.set(true);

    const base64 =
      cropCanvas
        .toDataURL('image/jpeg', 0.85)
        .split(',')[1];

    this.scannerService.processScan(base64)
      .then(res => {

        if (res.status === 'valid') {
          console.log('✅ MATCH:', res);
        }

        this.isProcessing.set(false);
        requestAnimationFrame(() => this.processFrame());
      })
      .catch(() => {
        this.isProcessing.set(false);
        requestAnimationFrame(() => this.processFrame());
      });
  }

  /* ---------------- CLEANUP ---------------- */

  ngOnDestroy() {
    this.closeScanner();
  }

  closeScanner() {
    this.stream?.getTracks().forEach(t => t.stop());
  }
}
