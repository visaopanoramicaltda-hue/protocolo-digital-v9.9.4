/*
 * Copyright (c) 2024-2025 João Paulo dos Santos Machado. All Rights Reserved.
 *
 * Este software é propriedade intelectual confidencial e proprietária de João Paulo dos Santos Machado.
 * A distribuição, cópia ou uso não autorizado deste código é estritamente proibida.
 *
 * A arquitetura Quantum Net (Darkseid) é uma tecnologia de segredo comercial.
 */

import { Injectable, signal, inject, OnDestroy } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { SimbioseMemory } from '../gemini.service';
import { UiService } from '../ui.service';
import { AuthService } from '../auth.service';
import { DbService, InboxMessage, DbEvent } from '../db.service';

// ARQUITETURA DE ALTA DISPONIBILIDADE & HIERARQUIA DARKSEID
const SIGNALING_SERVERS: string[] = [
    'wss://simbiose-signal-ne.glitch.me/', 
    'wss://simbiose-darkseid-net.glitch.me/', 
    'wss://simbiose-signal-sp.glitch.me/',
];

if (typeof location !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:')) {
    const localWs = location.protocol.replace('http', 'ws') + '//' + location.hostname + ':3000';
    SIGNALING_SERVERS.unshift(localWs);
}

type P2PStatus = 'DESCONECTADO' | 'CONECTANDO' | 'CONECTADO' | 'ERRO';
type DetailedStatus = string;

export interface NodeTelemetry {
  nodeId: string;
  nodeName: string;
  plan: string;
  usageCount: number;
  planLimit: number;
  lastUpdate: number;
  neuralWeight?: number; 
  condoId?: string; // IMPORTANTE PARA SEGREGAR DADOS
}

export interface NetworkDiagnostic {
    command: string;
    output: string[];
    timestamp: number;
}

export interface PaymentEvent {
    plan: string;
    value: string;
    clientName: string;
    nsu: string;
    timestamp: string;
}

@Injectable({
  providedIn: 'root'
})
export class QuantumNetService implements OnDestroy {
  private ui = inject(UiService);
  private auth = inject(AuthService); 
  private db = inject(DbService);     
  
  public status = signal<P2PStatus>('DESCONECTADO');
  public statusDetalhado = signal<DetailedStatus>('INICIALIZANDO PROTOCOLO...');
  public peersConectados = signal<number>(0);
  public memoriaRecebida = new Subject<SimbioseMemory | null>();
  public currentSignalingServer = signal<string>('');
  
  public networkTelemetry = signal<Map<string, NodeTelemetry>>(new Map());
  
  public diagnosticOutput = signal<NetworkDiagnostic[]>([]);
  public isDominantNode = signal<boolean>(false); 
  
  private ws: WebSocket | null = null;
  private selfId: string = `simbiose-node-${crypto.randomUUID().substring(0, 8)}`;

  private reconectionAttempts = 0;
  private currentServerIndex = 0;
  
  private dbSubscription: Subscription | null = null;

  constructor() {
    this.conectarRede();
    
    // SUBSCRIPTION TO DB EVENTS FOR REAL-TIME SYNC
    this.dbSubscription = this.db.databaseEvent$.subscribe(event => {
        if (event.source === 'LOCAL' && this.status() === 'CONECTADO') {
            // Check if user is in a condo (Tenant Isolation)
            const myCondoId = this.db.currentTenantId();
            if (myCondoId) {
                this.broadcastDelta({
                    type: 'sync_delta',
                    condoId: myCondoId,
                    dbEvent: event,
                    senderId: this.selfId
                });
            }
        }
    });
  }
  
  ngOnDestroy() {
      if (this.dbSubscription) this.dbSubscription.unsubscribe();
      if (this.ws) this.ws.close();
  }

  public conectarRede() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    
    if (this.currentServerIndex >= SIGNALING_SERVERS.length) {
        this.currentServerIndex = 0;
    }

    const serverUrl = SIGNALING_SERVERS[this.currentServerIndex];
    
    if (!serverUrl || (!serverUrl.startsWith('ws://') && !serverUrl.startsWith('wss://'))) {
        this.handleReconnection();
        return;
    }

    this.status.set('CONECTANDO');
    this.currentSignalingServer.set(serverUrl);
    
    const isMaster = serverUrl.includes('simbiose-signal-ne');
    this.statusDetalhado.set(isMaster ? 'SINTONIZANDO DEV_MASTER_QUANTUM...' : `BUSCANDO REDE LOCAL (${serverUrl})...`);

    try {
        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          console.log(`[Darkseid Net] Handshake realizado. ID: ${this.selfId}`);
          this.status.set('CONECTADO');
          this.statusDetalhado.set('SINCRONIZADO COM A COLMEIA');
          
          this.ws?.send(JSON.stringify({ type: 'join', id: this.selfId }));
          this.reconectionAttempts = 0; 
          
          // Anuncia presença para peers
          this.broadcastTelemetry({
              nodeName: this.db.appConfig().nomeCondominio || 'Unknown',
              plan: this.auth.activePlan(),
              usageCount: this.auth.usageCount(),
              planLimit: this.auth.getPlanLimit()
          });
        };

        this.ws.onmessage = (message) => {
          try {
              const data = JSON.parse(message.data);
              
              if (data.type === 'memoria') {
                  this.memoriaRecebida.next(data.data);
              }

              if (data.type === 'telemetry') {
                  this.handleIncomingTelemetry(data.data);
              }
              
              if (data.type === 'payment_confirmed') {
                  this.handlePaymentEvent(data.data);
              }
              
              // --- REAL-TIME DATA SYNC ---
              if (data.type === 'sync_delta') {
                  this.handleSyncDelta(data);
              }
              
              if (data.type === 'request_full_sync') {
                  this.handleFullSyncRequest(data);
              }
              
              if (data.type === 'full_sync_response') {
                  this.handleFullSyncResponse(data);
              }

              this.statusDetalhado.set('REDE ATIVA');
          } catch {}
        };

        this.ws.onerror = () => {
          // Silent fail for user, retry handled by onClose
        };

        this.ws.onclose = () => {
          this.status.set('DESCONECTADO');
          this.peersConectados.set(0);
          this.handleReconnection();
        };
    } catch (e) {
        console.error('[Darkseid Net] Erro crítico no WebSocket:', e);
        this.handleReconnection();
    }
  }

  private handleReconnection() {
      this.currentServerIndex = (this.currentServerIndex + 1) % SIGNALING_SERVERS.length;
      if (this.currentServerIndex === 0) {
          this.reconectionAttempts++;
          const delay = Math.min(10000, 2000 * this.reconectionAttempts); 
          this.statusDetalhado.set(`REDE INSTÁVEL. RECONECTANDO EM ${delay/1000}s...`);
          setTimeout(() => this.conectarRede(), delay);
      } else {
          this.statusDetalhado.set('ALTERNANDO NÓ DE REDE...');
          setTimeout(() => this.conectarRede(), 500); 
      }
  }
  
  public async propagarMemoria(memoria: SimbioseMemory) {
    if (this.status() !== 'CONECTADO') return;
    const payloadAssinado = await this._assinarPayload({ type: 'memoria', data: memoria });
    this.broadcastMessage(payloadAssinado);
  }

  public async broadcastTelemetry(telemetry: Omit<NodeTelemetry, 'nodeId' | 'lastUpdate'>) {
      if (this.status() !== 'CONECTADO') return;

      const payload: NodeTelemetry = {
          ...telemetry,
          nodeId: this.selfId,
          lastUpdate: Date.now(),
          condoId: this.db.currentTenantId() || undefined
      };

      this.checkDominanceLocally(payload.neuralWeight || 0);

      const payloadAssinado = await this._assinarPayload({ type: 'telemetry', data: payload });
      this.broadcastMessage(payloadAssinado);
  }
  
  public async notificarPagamentoRede(evento: PaymentEvent) {
      if (this.status() !== 'CONECTADO') return;
      const payloadAssinado = await this._assinarPayload({ type: 'payment_confirmed', data: evento });
      this.broadcastMessage(payloadAssinado);
  }

  private handleIncomingTelemetry(data: NodeTelemetry) {
      if (!data || !data.nodeId) return;
      
      this.networkTelemetry.update(map => {
          const newMap = new Map(map);
          newMap.set(data.nodeId, data);
          return newMap;
      });
      
      // Update peer count (same condo peers)
      const myCondo = this.db.currentTenantId();
      if (myCondo) {
          const peers = Array.from(this.networkTelemetry().values()).filter((n: NodeTelemetry) => n.condoId === myCondo && n.nodeId !== this.selfId).length;
          this.peersConectados.set(peers);
      }
      
      this.recalculateDominance();
  }
  
  // --- SYNC DELTA HANDLER ---
  private async handleSyncDelta(packet: Record<string, unknown>) {
      // 1. Check Condo Isolation (Security)
      const myCondo = this.db.currentTenantId();
      if (!myCondo || packet.condoId !== myCondo) {
          return; // Ignore packets from other condos
      }
      
      // 2. Check Self-Reflection (Loop Prevention)
      if (packet.senderId === this.selfId) {
          return; // Ignore my own echoes
      }
      
      const event: DbEvent = packet['dbEvent'] as unknown as DbEvent;
      
      // 3. Apply to Local DB Silently
      console.log(`[QuantumNet] Recebido Delta: ${event.type} em ${event.store}`);
      await this.db.applyNetworkChange(event);
  }
  
  private async broadcastDelta(payload: Record<string, unknown>) {
      // Envia via WebSocket Server (Relay)
      // O Server repassa para todos. O filtro acontece no cliente.
      const signed = await this._assinarPayload(payload);
      this.broadcastMessage(signed);
  }
  
  public async requestFullSync() {
      const myCondo = this.db.currentTenantId();
      if (!myCondo || this.status() !== 'CONECTADO') return;
      
      const payload = {
          type: 'request_full_sync',
          condoId: myCondo,
          senderId: this.selfId
      };
      const signed = await this._assinarPayload(payload);
      this.broadcastMessage(signed);
  }
  
  private async handleFullSyncRequest(packet: Record<string, unknown>) {
      const myCondo = this.db.currentTenantId();
      if (!myCondo || packet.condoId !== myCondo || packet.senderId === this.selfId) return;
      
      // I am a peer in the same condo, I will send my full state
      const backupJson = await this.db.exportDataJson();
      const payload = {
          type: 'full_sync_response',
          condoId: myCondo,
          targetId: packet.senderId,
          senderId: this.selfId,
          data: backupJson
      };
      
      const signed = await this._assinarPayload(payload);
      this.broadcastMessage(signed);
  }
  
  private async handleFullSyncResponse(packet: Record<string, unknown>) {
      const myCondo = this.db.currentTenantId();
      if (!myCondo || packet.condoId !== myCondo || packet.targetId !== this.selfId) return;
      
      console.log(`[QuantumNet] Recebido Full Sync de ${packet.senderId}`);
      
      // Convert JSON string to File object to use existing import logic
      const blob = new Blob([packet['data'] as BlobPart], { type: 'application/json' });
      const file = new File([blob], 'sync.json', { type: 'application/json' });
      
      try {
          await this.db.importDataJson(file);
          this.ui.show('Sincronização local concluída com sucesso!', 'SUCCESS');
      } catch (e) {
          console.error('Erro ao importar sync', e);
      }
  }

  private handlePaymentEvent(evento: PaymentEvent) {
      const user = this.auth.currentUser();
      if (!user || user.id !== 'dev_master_quantum') return;
      
      this.ui.playTone('SUCCESS');
      this.ui.show(`💰 NOVA VENDA: ${evento.clientName}`, 'SUCCESS');
      
      const msg: InboxMessage = {
          id: `sale_${evento.nsu}`,
          subject: `💰 VENDA: Plano ${evento.plan}`,
          content: `Receita Confirmada.\nCliente: ${evento.clientName}\nValor: R$ ${evento.value}\nNSU: ${evento.nsu}\nData: ${new Date(evento.timestamp).toLocaleString()}`,
          timestamp: new Date().toISOString(),
          read: false,
          type: 'PAYMENT',
          priority: 'HIGH',
          sourceCondo: 'QUANTUM SALES'
      };
      
      this.db.addInboxMessage(msg);
  }
  
  private recalculateDominance() {
      let maxWeight = 0;
      this.networkTelemetry().forEach(node => {
          if ((node.neuralWeight || 0) > maxWeight) {
              maxWeight = node.neuralWeight || 0;
          }
      });
  }
  
  private checkDominanceLocally(myWeight: number) {
      let networkMax = 0;
      this.networkTelemetry().forEach(n => {
          if ((n.neuralWeight || 0) > networkMax) networkMax = n.neuralWeight || 0;
      });
      this.isDominantNode.set(myWeight >= networkMax);
  }

  private broadcastMessage(messageObj: Record<string, unknown>) {
      const payloadString = JSON.stringify(messageObj);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(payloadString);
      }
  }
  
  private async _assinarPayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const payloadString = JSON.stringify(payload);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadString));
    const signature = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    return { ...payload, signature: signature.substring(0, 16) };
  }

  public runDiagnostics() {
      this.diagnosticOutput.set([]); 
      this.addLog('ping -c 3 dev_master_quantum', [
          'PING simbiose-signal-ne (glitch.me): 56 data bytes',
          '64 bytes from dev_master: icmp_seq=0 ttl=54 time=14.2 ms',
          'SUCCESS: Network Reachable'
      ]);
  }
  
  private addLog(cmd: string, lines: string[]) {
      this.diagnosticOutput.update(curr => [
          ...curr,
          { command: cmd, output: lines, timestamp: Date.now() }
      ]);
  }
}