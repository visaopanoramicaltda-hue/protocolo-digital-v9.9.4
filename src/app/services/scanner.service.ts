import { Injectable } from '@angular/core';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';

@Injectable({ providedIn: 'root' })
export class ScannerService {

  async scanLogistica(): Promise<string> {
    // Adiciona o overlay de scanner industrial
    const isSupported = await BarcodeScanner.isSupported();
    if (!isSupported.supported) return 'Não suportado';

    await BarcodeScanner.requestPermissions();
    
    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.QrCode, BarcodeFormat.Code128, BarcodeFormat.Ean13],
    });

    return barcodes[0]?.displayValue || '';
  }
}
