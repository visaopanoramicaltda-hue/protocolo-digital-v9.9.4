import { Injectable, signal } from '@angular/core';
import { OcrExtractionResult } from './gemini.service';

@Injectable({
  providedIn: 'root'
})
export class ScannerDataService {
  scannedData = signal<OcrExtractionResult | null>(null);
  autoOpenScanner = signal(false);

  setScannedData(data: OcrExtractionResult) {
    this.scannedData.set(data);
  }

  clearScannedData() {
    this.scannedData.set(null);
  }

  triggerAutoOpen() {
    this.autoOpenScanner.set(true);
  }

  clearAutoOpen() {
    this.autoOpenScanner.set(false);
  }
}
