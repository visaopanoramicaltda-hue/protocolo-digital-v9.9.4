import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  public isOnline = signal<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  private syncQueue: unknown[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
      this.loadQueue();
    }
  }

  private handleOnline() {
    this.isOnline.set(true);
    this.processQueue();
  }

  private handleOffline() {
    this.isOnline.set(false);
  }

  public queueRequest(request: unknown) {
    this.syncQueue.push(request);
    this.saveQueue();
    
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then(swRegistration => {
        (swRegistration as any).sync.register('sync-offline-requests').catch(() => {});
      });
    }
  }

  private async processQueue() {
    if (this.syncQueue.length === 0) return;
    
    const queue = [...this.syncQueue];
    this.syncQueue = [];
    this.saveQueue();
    
    for (const req of queue) {
      try {
        // Process request
      } catch (err) {
        this.queueRequest(req);
      }
    }
  }

  private saveQueue() {
    try {
      localStorage.setItem('pwa_sync_queue', JSON.stringify(this.syncQueue));
    } catch (e) {}
  }

  private loadQueue() {
    try {
      const saved = localStorage.getItem('pwa_sync_queue');
      if (saved) {
        this.syncQueue = JSON.parse(saved);
      }
    } catch (e) {}
  }
}
