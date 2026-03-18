import { Injectable, signal } from '@angular/core';
import { OcrExtractionResult } from './gemini.service';
import { SecurityVerdict } from './security-protocol.service';

@Injectable({
  providedIn: 'root'
})
export class ScannerDataService {
  scannedData = signal<OcrExtractionResult | null>(null);
  securityVerdict = signal<SecurityVerdict | null>(null);
  autoOpenScanner = signal(false);

  setScannedData(data: OcrExtractionResult, verdict?: SecurityVerdict) {
    this.scannedData.set(data);
    if (verdict) this.securityVerdict.set(verdict);
  }

  clearScannedData() {
    this.scannedData.set(null);
    this.securityVerdict.set(null);
  }

  triggerAutoOpen() {
    this.autoOpenScanner.set(true);
  }

  clearAutoOpen() {
    this.autoOpenScanner.set(false);
  }
}
