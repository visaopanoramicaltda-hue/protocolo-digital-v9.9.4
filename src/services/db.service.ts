
import { Injectable, signal, inject } from '@angular/core';
import { UiService } from './ui.service';
import { BenchmarkService } from './benchmark.service';
import { SimbioseHashService } from './core/simbiose-hash.service';
import { Subject } from 'rxjs';

// --- INTERFACES COM SUPORTE A SHARDING (condoId) ---
export interface Porteiro { id: string; nome: string; cpf?: string; senha: string; isAdmin: boolean; isDev?: boolean; condoId?: string; hasFingerprint?: boolean; }
export interface Morador { id: string; nome: string; bloco: string; apto: string; telefone?: string; tags?: string[]; isPrincipal?: boolean; condoId?: string; }
export interface ContatoCondominio { Nome: string; Bloco: string; Apartamento: string; Celular: string; Principal?: string; }
export interface Encomenda { id: string; codigoRastreio?: string; transportadora?: string; destinatarioNome: string; bloco?: string; apto?: string; condicaoFisica?: string; dataEntrada: string; dataSaida?: string; status: 'PENDENTE' | 'ENTREGUE' | 'CANCELADA' | 'PRE_LOTE'; porteiroEntradaId: string; porteiroSaidaId?: string; quemRetirou?: string; assinaturaBase64?: string; fotoBase64?: string; integrityHash?: string; observacoes?: string; nomeEntregador?: string; telefoneEntregador?: string; condoId?: string; lastModified?: number; }
export interface SystemLog { id: string; timestamp: string; action: 'LOGIN' | 'CREATE' | 'UPDATE' | 'DELETE' | 'BACKUP' | 'SECURITY' | 'CONFIG'; details: string; userId: string; userName: string; condoId?: string; }

export interface InboxMessage { 
    id: string; 
    subject: string; 
    content: string; 
    timestamp: string; 
    read: boolean; 
    type: 'SYSTEM' | 'PAYMENT' | 'SECURITY' | 'NETWORK_REPORT' | 'DAILY_REPORT'; 
    priority: 'HIGH' | 'NORMAL';
    sourceCondo?: string;
    condoId?: string;
    actionLink?: string;
    metadata?: Record<string, unknown>;
}

export interface LinkedCondo {
    id: string;
    name: string;
    lastSync: string;
    status: 'ONLINE' | 'OFFLINE' | 'WARNING';
    stats: {
        pendingPackages: number;
        efficiency: number;
    };
}

export interface AppConfig { 
    id: string; 
    ocrTemperature: number; 
    ocrPromptMode: 'FAST' | 'BALANCED' | 'ADVANCED'; 
    autoCorrectionEnabled: boolean; 
    googleClientId?: string;
    scannerFPS: 5 | 15 | 30;
    nomeCondominio?: string; 
    activePlan?: string; 
    condoId?: string; 
    kioskMode?: boolean; // NOVO: Persistência de Kiosk no Backup
    localWifiSync?: boolean; // NOVO: Sincronização Celular/Desktop na mesma rede
    adminFingerprintRegistered?: boolean;
}

export interface BackupData { 
    porteiros: Porteiro[]; 
    moradores: Morador[]; 
    encomendas: Encomenda[]; 
    logs?: SystemLog[]; 
    inbox?: InboxMessage[]; 
    config?: AppConfig; 
    exportedAt: string; 
    appVersion: string;
    auxiliary?: {
        learned_carriers?: string[];
        learned_senders?: string[];
        usage_count?: number;
        global_label_usage?: number;
    }
}

// --- SYNC EVENT DEFINITIONS ---
export type DbStoreName = 'porteiros' | 'moradores' | 'encomendas' | 'config' | 'inbox';
export interface DbEvent {
    type: 'CREATE' | 'UPDATE' | 'DELETE';
    store: DbStoreName;
    data: unknown; // O objeto salvo ou o ID deletado
    id: string;
    timestamp: number;
    source: 'LOCAL' | 'NETWORK';
}

// Interface para controle de fluxo Dashboard <-> Admin
export interface FlowState {
    active: boolean;
    type: 'WITHDRAWAL_REGISTER';
    data: {
        packageId: string;
        tempName: string;
        returnToDashboard: boolean;
    };
}

@Injectable({
  providedIn: 'root'
})
export class DbService {
  private ui = inject(UiService);
  private benchmark = inject(BenchmarkService);
  private hashService = inject(SimbioseHashService);

  // --- SIGNALS ---
  porteiros = signal<Porteiro[]>([]);
  moradores = signal<Morador[]>([]);
  encomendas = signal<Encomenda[]>([]);
  logs = signal<SystemLog[]>([]);
  inbox = signal<InboxMessage[]>([]); 
  linkedCondos = signal<LinkedCondo[]>([]); 
  carriers = signal<string[]>([]);
  senders = signal<string[]>([]);
  
  // STATE MANAGEMENT FOR CROSS-COMPONENT FLOWS
  tempFlowState = signal<FlowState | null>(null);
  
  appConfig = signal<AppConfig>({
    id: 'main_config', 
    ocrTemperature: 0.3, 
    ocrPromptMode: 'BALANCED', 
    autoCorrectionEnabled: true, 
    googleClientId: '',
    scannerFPS: 15,
    nomeCondominio: '',
    activePlan: 'PENDENTE',
    condoId: crypto.randomUUID(),
    kioskMode: false // DEFAULT ABSOLUTO: FALSE (Responsivo Nativo)
  });
  
  currentTenantId = signal<string | null>(null);
  initialized = signal(false); 
  lastBackupTime = signal<number | null>(null);
  
  // EVENT BUS DE SINCRONIA
  public onDataChange = new Subject<void>(); // Trigger genérico para UI
  public databaseEvent$ = new Subject<DbEvent>(); // Trigger granular para QuantumNet

  private db: IDBDatabase | null = null;
  private readonly DB_NAME = 'ProtocoloDigitalDB';
  private readonly DB_VERSION = 10; 
  private readonly APP_VERSION_INTERNAL = '9.9.4';
  
  // CHAVE MESTRA PARA BACKUP AUTOMÁTICO (SOBRESCRITA)
  private readonly AUTO_BACKUP_KEY = 999999999; 

  private readonly MASTER_CARRIERS_DATASET = ["CORREIOS", "SEDEX", "JADLOG", "LOGGI", "MERCADO LIVRE", "AMAZON", "MAGALU", "SHOPEE", "FEDEX", "DHL", "TNT", "AZUL CARGO", "TOTAL EXPRESS", "BRASPRESS"]; 
  private readonly DEFAULT_SENDERS = ["Caixa", "Banco do Brasil", "Itaú", "Nubank", "Detran", "Receita Federal", "Enel", "Sabesp", "Vivo", "Claro", "Tim", "Unimed"];

  private readonly CONFIRMATION_COUNT_KEY = 'simbiose_confirmation_counts';
  private readonly SECONDARY_BACKUP_KEY = 'simbiose_secondary_snapshot';

  constructor() {
    this.benchmark.start('quantum_boot');
    this.bootSequence();
  }
  
  private notifyChange() {
      this.onDataChange.next();
  }

  private emitDbEvent(type: 'CREATE' | 'UPDATE' | 'DELETE', store: DbStoreName, data: unknown, id: string) {
      this.databaseEvent$.next({
          type,
          store,
          data,
          id,
          timestamp: Date.now(),
          source: 'LOCAL'
      });
  }

  private async bootSequence() {
      try {
          await Promise.race([
              this.initDatabase(),
              new Promise((_, reject) => setTimeout(() => reject('DB_TIMEOUT'), 30000))
          ]);

          this.initCarriers();
          this.initSenders();
          this.refreshLastBackupTime();

          await this.loadLayer1_Critical();
          await this.loadLayer2_Operational(); 
          
          this.loadInbox();
          this.loadLinkedCondos();
          await this.runMigrationRoutine();

          this.initialized.set(true); 
          this.benchmark.end('quantum_boot');
          
          setTimeout(() => this.loadLayer3_Archive(), 1000);
          
      } catch (e) {
          console.error('FATAL BOOT ERROR:', e);
          this.ui.show('Erro crítico ao iniciar banco de dados. Tente recarregar.', 'ERROR');
          this.initialized.set(true); 
      }
  }

  private initCarriers() {
    const saved = localStorage.getItem('learned_carriers');
    if(saved) this.carriers.set(JSON.parse(saved));
    else this.carriers.set(this.MASTER_CARRIERS_DATASET);
  }
  private initSenders() {
    const saved = localStorage.getItem('learned_senders');
    if(saved) this.senders.set(JSON.parse(saved));
    else this.senders.set(this.DEFAULT_SENDERS);
  }
  private refreshLastBackupTime() {
    const time = parseInt(localStorage.getItem('simbiose_last_backup_timestamp') || '0');
    this.lastBackupTime.set(time);
  }

  private async getAllFromStore<T>(storeName: string): Promise<T[]> {
    if (!this.db) return [];
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async loadLayer1_Critical() {
    const porteiros = await this.getAllFromStore<Porteiro>('porteiros');
    const configList = await this.getAllFromStore<AppConfig>('config');
    this.porteiros.set(porteiros);
    if (configList.length > 0) {
        const config = configList[0];
        // FORÇA KIOSK OFF - Responsividade Movel Nativa sempre vence na carga inicial
        config.kioskMode = false; 
        this.appConfig.set(config);
        
        // Limpa flag de Kiosk do LocalStorage para evitar reativação acidental
        localStorage.removeItem('simbiose_kiosk_active');
    }
  }

  async loadLayer2_Operational() {
    const moradores = await this.getAllFromStore<Morador>('moradores');
    const encomendas = await this.getAllFromStore<Encomenda>('encomendas');
    
    // REPARAÇÃO AUTOMÁTICA DE DADOS (Garante que todos usem o condoId canônico do sistema)
    const canonicalTenant = this.appConfig().condoId;
    if (canonicalTenant && this.db) {
        let changed = false;
        const moradoresToUpdate: Morador[] = [];
        const encomendasToUpdate: Encomenda[] = [];

        for (const m of moradores) {
            if (!m.condoId || m.condoId !== canonicalTenant) {
                m.condoId = canonicalTenant;
                moradoresToUpdate.push(m);
                changed = true;
            }
        }
        for (const e of encomendas) {
            if (!e.condoId || e.condoId !== canonicalTenant) {
                e.condoId = canonicalTenant;
                encomendasToUpdate.push(e);
                changed = true;
            }
        }

        if (changed) {
            // Executa atualizações em lote para evitar múltiplas transações
            if (moradoresToUpdate.length > 0) await this.saveMany('moradores', moradoresToUpdate, false);
            if (encomendasToUpdate.length > 0) await this.saveMany('encomendas', encomendasToUpdate, false);
            this.notifyChange();
        }
    }

    this.applyTenantFilter(moradores, encomendas);
  }

  private applyTenantFilter(allMoradores: Morador[], allEncomendas: Encomenda[]) {
      const tenant = this.currentTenantId();
      
      // LÓGICA DE SEGURANÇA: Se houver apenas um condomínio no banco, não filtramos.
      // Isso evita que dados sumam se o ID do porteiro não bater exatamente com o ID dos dados,
      // mas o ambiente for claramente de um único condomínio.
      const uniqueCondos = new Set(allEncomendas.map(e => e.condoId).filter(id => !!id));
      
      if (tenant && uniqueCondos.size > 1) {
          // Em ambientes multi-condomínio reais, aplicamos o filtro estrito
          this.moradores.set(allMoradores.filter(m => m.condoId === tenant || !m.condoId));
          this.encomendas.set(allEncomendas.filter(e => e.condoId === tenant || !e.condoId));
      } else {
          // Em ambientes de condomínio único ou sem tenant, mostramos tudo para evitar perda de visibilidade
          this.moradores.set(allMoradores);
          this.encomendas.set(allEncomendas);
      }
  }

  async reloadSessionData() {
      await this.loadLayer2_Operational();
      await this.loadInbox();
      await this.loadLinkedCondos();
  }

  async loadInbox() {
      const msgs = await this.getAllFromStore<InboxMessage>('inbox');
      const tenant = this.currentTenantId();
      const uniqueCondos = new Set(msgs.map(m => m.condoId).filter(id => !!id));

      if (tenant && uniqueCondos.size > 1) {
          this.inbox.set(msgs.filter(m => !m.condoId || m.condoId === tenant));
      } else {
          this.inbox.set(msgs);
      }
  }

  async loadLinkedCondos() {
      const stored = localStorage.getItem('simbiose_linked_condos');
      if (stored) this.linkedCondos.set(JSON.parse(stored));
  }

  async runMigrationRoutine() {
      const currentVer = localStorage.getItem('db_schema_version');
      if (currentVer !== this.APP_VERSION_INTERNAL) {
          // MIGRATION: Ensure admin has a condoId
          const porteiros = await this.getAllFromStore<Porteiro>('porteiros');
          const admin = porteiros.find(p => p.isAdmin);
          if (admin && !admin.condoId) {
              admin.condoId = crypto.randomUUID();
              await this.saveItem('porteiros', admin);
          }
          
          // MIGRATION: Ensure packages have a condoId
          if (admin && admin.condoId) {
              const encomendas = await this.getAllFromStore<Encomenda>('encomendas');
              const toUpdate: Encomenda[] = [];
              for (const enc of encomendas) {
                  if (!enc.condoId) {
                      enc.condoId = admin.condoId;
                      toUpdate.push(enc);
                  }
              }
              if (toUpdate.length > 0) {
                  await this.saveMany('encomendas', toUpdate);
              }
          }
          
          localStorage.setItem('db_schema_version', this.APP_VERSION_INTERNAL);
      }
  }

  async loadLayer3_Archive() {
      const logs = await this.getAllFromStore<SystemLog>('logs');
      const tenant = this.currentTenantId();
      const uniqueCondos = new Set(logs.map(l => l.condoId).filter(id => !!id));

      if (tenant && uniqueCondos.size > 1) {
          this.logs.set(logs.filter(l => l.condoId === tenant || !l.condoId));
      } else {
          this.logs.set(logs);
      }
  }

  // --- CORE CRUD (COM BROADCAST AUTOMÁTICO) ---
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async saveItem(storeName: string, item: unknown, emitEvent = true) {
      if (!this.db) return;
      
      // Timestamp de modificação para resolução de conflitos
      if (typeof item === 'object' && item !== null) {
          item['lastModified'] = Date.now();
      }

      return new Promise<void>((resolve, reject) => {
          try {
              const tx = this.db!.transaction(storeName, 'readwrite');
              const store = tx.objectStore(storeName);
              const req = store.put(item);
              
              tx.oncomplete = () => {
                  if (emitEvent && ['porteiros', 'moradores', 'encomendas', 'config', 'inbox'].includes(storeName)) {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  this.emitDbEvent('UPDATE', storeName as DbStoreName, item, (item as any).id);
                  }
                  resolve();
              };
              
              tx.onerror = () => reject(tx.error || new Error(`Transaction error in ${storeName}`));
              tx.onabort = () => reject(new Error(`Transaction aborted in ${storeName}`));
              
              req.onerror = () => reject(req.error);
          } catch (e) {
              reject(e);
          }
      });
  }

  async deleteItem(storeName: string, id: string | number, emitEvent = true) {
      if (!this.db) return;
      return new Promise<void>((resolve, reject) => {
          try {
              const tx = this.db!.transaction(storeName, 'readwrite');
              const store = tx.objectStore(storeName);
              const req = store.delete(id);
              
              tx.oncomplete = () => {
                  if (emitEvent && ['porteiros', 'moradores', 'encomendas', 'config', 'inbox'].includes(storeName)) {
                      this.emitDbEvent('DELETE', storeName as DbStoreName, null, id.toString());
                  }
                  resolve();
              };
              
              tx.onerror = () => reject(tx.error || new Error(`Transaction error in ${storeName}`));
              tx.onabort = () => reject(new Error(`Transaction aborted in ${storeName}`));
              
              req.onerror = () => reject(req.error);
          } catch (e) {
              reject(e);
          }
      });
  }

  async saveMany(storeName: string, items: unknown[], emitEvent = true) {
      if (!this.db || items.length === 0) return;
      return new Promise<void>((resolve, reject) => {
          const tx = this.db!.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          items.forEach(item => {
              if (typeof item === 'object' && item !== null) {
                  (item as Record<string, unknown>)['lastModified'] = Date.now();
              }
              store.put(item);
          });
          tx.oncomplete = () => {
              if (emitEvent) this.notifyChange();
              resolve();
          };
          tx.onerror = () => reject(tx.error);
      });
  }

  async deleteMany(storeName: string, ids: (string | number)[], emitEvent = true) {
      if (!this.db || ids.length === 0) return;
      return new Promise<void>((resolve, reject) => {
          const tx = this.db!.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          ids.forEach(id => store.delete(id));
          tx.oncomplete = () => {
              if (emitEvent) this.notifyChange();
              resolve();
          };
          tx.onerror = () => reject(tx.error);
      });
  }

  // --- APPLY NETWORK CHANGE (SILENT MODE) ---
  async applyNetworkChange(event: DbEvent) {
      if (!this.db) return;
      console.log(`[DbService] Aplicando delta de rede: ${event.type} em ${event.store} (${event.id})`);
      
      if (event.type === 'DELETE') {
          await this.deleteItem(event.store, event.id, false);
      } else {
          await this.saveItem(event.store, event.data, false);
      }
      
      // Atualiza Signals em Memória
      if (event.store === 'encomendas') await this.loadLayer2_Operational();
      if (event.store === 'moradores') await this.loadLayer2_Operational();
      if (event.store === 'inbox') await this.loadInbox();
      
      this.notifyChange();
  }

  async getItem<T>(storeName: string, key: string | number): Promise<T | undefined> {
      if (!this.db) return undefined;
      return new Promise((resolve, reject) => {
          try {
              const tx = this.db!.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const req = store.get(key);
              
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
              tx.onerror = () => reject(tx.error);
              tx.onabort = () => reject(new Error(`Transaction aborted in ${storeName} (GET)`));
          } catch (e) {
              reject(e);
          }
      });
  }

  // --- CRUD WRAPPERS ---
  public async addInboxMessage(msg: InboxMessage) {
      if (!msg.condoId && this.currentTenantId()) msg.condoId = this.currentTenantId()!;
      await this.saveItem('inbox', msg);
      const tenant = this.currentTenantId();
      if (!msg.condoId || !tenant || msg.condoId === tenant) {
          this.inbox.update(list => [msg, ...list]);
          if (msg.priority === 'HIGH') this.ui.showNativeNotification(msg.subject, msg.content);
          else this.ui.show('Nova mensagem.', 'INFO');
      }
      this.notifyChange();
  }

  async addEncomenda(enc: Encomenda) {
      const tenant = this.currentTenantId();
      if (tenant && !enc.condoId) enc.condoId = tenant;
      await this.saveItem('encomendas', enc);
      this.encomendas.update(l => [enc, ...l]);
      this.notifyChange();
  }

  async updateEncomenda(id: string, partial: Partial<Encomenda>) {
      const current = this.encomendas().find(e => e.id === id);
      if (current) {
          const updated = { ...current, ...partial };
          await this.saveItem('encomendas', updated);
          this.encomendas.update(l => l.map(e => e.id === id ? updated : e));
          this.notifyChange();
      }
  }

  async loadFullEncomenda(id: string): Promise<Encomenda | undefined> {
      return this.getItem<Encomenda>('encomendas', id);
  }

  async addPorteiro(p: Porteiro) {
      await this.saveItem('porteiros', p);
      this.porteiros.update(l => [...l, p]);
      this.notifyChange();
  }

  async updatePorteiro(id: string, partial: Partial<Porteiro>) {
      const current = this.porteiros().find(p => p.id === id);
      if (current) {
          const updated = { ...current, ...partial };
          await this.saveItem('porteiros', updated);
          this.porteiros.update(l => l.map(p => p.id === id ? updated : p));
          this.notifyChange();
      }
  }

  async deletePorteiro(id: string, requester: string) {
      await this.deleteItem('porteiros', id);
      this.porteiros.update(l => l.filter(p => p.id !== id));
      this.logAction('DELETE', `Porteiro removido: ${id}`, requester, 'Admin');
      this.notifyChange();
  }

  async addMorador(m: Morador) {
      const tenant = this.currentTenantId();
      if (tenant && !m.condoId) m.condoId = tenant;

      // Verifica duplicidade (Nome + Bloco + Apto)
      const isDuplicate = this.moradores().some(ex => 
          ex.id !== m.id &&
          ex.nome.toUpperCase() === m.nome.toUpperCase() &&
          ex.bloco.toUpperCase() === m.bloco.toUpperCase() &&
          ex.apto.toUpperCase() === m.apto.toUpperCase()
      );

      if (isDuplicate) {
          throw new Error(`Morador já cadastrado: ${m.nome} no ${m.bloco}/${m.apto}`);
      }

      await this.saveItem('moradores', m);
      
      const index = this.moradores().findIndex(ex => ex.id === m.id);
      if (index !== -1) {
          this.moradores.update(l => l.map(ex => ex.id === m.id ? m : ex));
      } else {
          this.moradores.update(l => [...l, m]);
      }
      
      this.notifyChange();
  }

  async importarContatos(contatos: ContatoCondominio[]) {
      const tenant = this.currentTenantId();
      const currentMoradores = this.moradores();
      const novosMoradores: Morador[] = [];
      let skipped = 0;

      for (const c of contatos) {
          const nome = c.Nome.trim().toUpperCase();
          const bloco = c.Bloco.trim().toUpperCase();
          const apto = c.Apartamento.trim().toUpperCase();

          if (!nome || (!bloco && !apto)) {
              skipped++;
              continue;
          }

          const exists = currentMoradores.some(m => 
              m.nome.toUpperCase() === nome && 
              m.bloco.toUpperCase() === bloco && 
              m.apto.toUpperCase() === apto
          ) || novosMoradores.some(m => 
              m.nome.toUpperCase() === nome && 
              m.bloco.toUpperCase() === bloco && 
              m.apto.toUpperCase() === apto
          );

          if (exists) {
              skipped++;
              continue;
          }

          novosMoradores.push({
              id: crypto.randomUUID(),
              nome: nome,
              bloco: bloco,
              apto: apto,
              telefone: c.Celular,
              condoId: tenant || undefined,
              isPrincipal: c.Principal ? (c.Principal.toUpperCase() === 'SIM' || c.Principal.toUpperCase() === 'TRUE') : true
          });
      }

      if (novosMoradores.length > 0) {
          await this.saveMany('moradores', novosMoradores);
          this.moradores.update(l => [...l, ...novosMoradores]);
          this.notifyChange();
      }
      
      if (skipped > 0) {
          this.ui.show(`${skipped} registros ignorados (duplicados ou inválidos).`, 'INFO');
      }

      return novosMoradores.length;
  }

  async deleteMorador(id: string) {
      await this.deleteItem('moradores', id);
      this.moradores.update(l => l.filter(m => m.id !== id));
      this.notifyChange();
  }

  async logAction(action: SystemLog['action'], details: string, userId?: string, userName?: string) {
      const log: SystemLog = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          action,
          details,
          userId: userId || 'system',
          userName: userName || 'System',
          condoId: this.currentTenantId() || undefined
      };
      await this.saveItem('logs', log);
      this.logs.update(l => [log, ...l]);
  }

  async saveAppConfig(config: AppConfig) {
      await this.saveItem('config', config);
      this.appConfig.set(config);
      
      // PERSISTÊNCIA KIOSK: Desabilitada para manter responsividade
      // Limpa qualquer flag antiga
      localStorage.removeItem('simbiose_kiosk_active');
      
      this.notifyChange();
  }

  resetStateForLogout() {
      this.currentTenantId.set(null);
      this.inbox.set([]);
      this.loadLayer1_Critical();
  }

  async ensureSpecialUsers() {
      const rodrigoId = 'rodrigo_simbiose_vip'; 
      const rodrigoPass = await this.hashService.hashText('000099');
      
      const rodrigoUser: Porteiro = {
          id: rodrigoId,
          nome: 'RODRIGO BORGES',
          cpf: '000.000.000-99',
          senha: rodrigoPass,
          isAdmin: true,
          isDev: false,
          condoId: 'simbiose_hq' 
      };

      await this.saveItem('porteiros', rodrigoUser);
      
      const existsRodrigo = this.porteiros().find(p => p.id === rodrigoId);
      if (!existsRodrigo) {
          this.porteiros.update(l => [...l, rodrigoUser]);
      }

      const luisId = 'luis_resolve_vip';
      const luisPass = await this.hashService.hashText('000066');
      
      const luisUser: Porteiro = {
          id: luisId,
          nome: 'LUIS MENDONÇA',
          cpf: '000.000.000-66',
          senha: luisPass,
          isAdmin: true,
          isDev: false, 
          condoId: 'grupo_resolve_hq' 
      };

      await this.saveItem('porteiros', luisUser);
      
      const existsLuis = this.porteiros().find(p => p.id === luisId);
      if (!existsLuis) {
          this.porteiros.update(l => [...l, luisUser]);
      }
  }

  async getUniqueHash(base64: string) { return this.hashService.hashText(base64); }
  learnCarrier(name: string) { if (!this.carriers().includes(name)) { this.carriers.set([...this.carriers(), name].sort()); localStorage.setItem('learned_carriers', JSON.stringify(this.carriers())); } }
  learnSender(name: string) { if (!this.senders().includes(name)) { this.senders.set([...this.senders(), name].sort()); localStorage.setItem('learned_senders', JSON.stringify(this.senders())); } }
  async markMessageAsRead(id: string) { const msg = this.inbox().find(m => m.id === id); if(msg){ msg.read = true; await this.saveItem('inbox', msg); this.inbox.update(l => l.map(m => m.id===id?msg:m)); this.notifyChange(); } }
  async deleteMessage(id: string) { await this.deleteItem('inbox', id); this.inbox.update(l => l.filter(m => m.id!==id)); this.notifyChange(); }
  updateLinkedCondo(condo: LinkedCondo) { this.linkedCondos.update(list => { const idx = list.findIndex(c => c.id === condo.id); if(idx>=0){ const n = [...list]; n[idx]=condo; return n; } return [...list, condo]; }); localStorage.setItem('simbiose_linked_condos', JSON.stringify(this.linkedCondos())); }

  // --- EXPORT / IMPORT ENGINE ---

  async exportData(): Promise<BackupData> {
      if (!this.db) throw new Error('DB not initialized');
      
      return new Promise((resolve, reject) => {
          const stores = ['porteiros', 'moradores', 'encomendas'];
          const tx = this.db!.transaction(stores, 'readonly');
          const result: Partial<BackupData> = {
              logs: [],
              inbox: [],
              config: this.appConfig(),
              exportedAt: new Date().toISOString(),
              appVersion: this.APP_VERSION_INTERNAL,
              auxiliary: {
                  learned_carriers: this.carriers(),
                  learned_senders: this.senders()
              }
          };

          const promises = stores.map(storeName => {
              return new Promise<void>((res, rej) => {
                  const store = tx.objectStore(storeName);
                  const req = store.getAll();
                  req.onsuccess = () => {
                      (result as Record<string, unknown>)[storeName] = req.result;
                      res();
                  };
                  req.onerror = () => rej(req.error);
              });
          });

          tx.oncomplete = () => resolve(result as BackupData);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(new Error('Export transaction aborted'));

          Promise.all(promises).catch(reject);
      });
  }

  async exportDataJson(): Promise<string> {
      const data = await this.exportData();
      return JSON.stringify(data, null, 2);
  }

  async importDataJson(file: File): Promise<boolean> {
      try {
          const text = await file.text();
          const data = JSON.parse(text);
          return await this.processBackupData(data);
      } catch { return false; }
  }

  async processBackupData(data: BackupData): Promise<boolean> {
      if (!this.db) return false;
      
      const currentTenant = this.currentTenantId();
      const shouldAdoptData = currentTenant !== null;

      // --- PROTOCOLO ANTI-KIOSK (RESTORE SAFEGUARD) ---
      if (data.config) {
          data.config.kioskMode = false;
      }
      
      this.ui.exitFullscreen();
      localStorage.removeItem('simbiose_kiosk_active');
      localStorage.removeItem('kiosk');

      const preservedConfig = this.appConfig();
      preservedConfig.kioskMode = false;

      await this.clearAllStores();
      
      // RESTAURAR DADOS EM LOTE
      if (data.porteiros?.length) {
          const porteiros = data.porteiros.map(p => {
              if (shouldAdoptData) p.condoId = currentTenant;
              return p;
          });
          await this.saveMany('porteiros', porteiros, false);
      }
      
      if (data.moradores?.length) {
          const moradores = data.moradores.map(m => {
              if (shouldAdoptData) m.condoId = currentTenant;
              return m;
          });
          await this.saveMany('moradores', moradores, false);
      }
      
      if (data.encomendas?.length) {
          const encomendas = data.encomendas.map(e => {
              if (shouldAdoptData) e.condoId = currentTenant;
              return e;
          });
          await this.saveMany('encomendas', encomendas, false);
      }
      
      if (data.config && data.config.nomeCondominio) {
          preservedConfig.nomeCondominio = data.config.nomeCondominio;
      }
      
      await this.saveItem('config', preservedConfig);
      this.appConfig.set(preservedConfig);
      
      if (data.auxiliary) {
          if (data.auxiliary.learned_carriers) {
              this.carriers.set(data.auxiliary.learned_carriers);
              localStorage.setItem('learned_carriers', JSON.stringify(data.auxiliary.learned_carriers));
          }
          if (data.auxiliary.learned_senders) {
              this.senders.set(data.auxiliary.learned_senders);
              localStorage.setItem('learned_senders', JSON.stringify(data.auxiliary.learned_senders));
          }
      }
      
      await this.enforceVipImmunity();
      await this.ensureSpecialUsers(); 
      await this.reloadSessionData();
      
      console.log('[Restore] Configuração local preservada (Kiosk OFF). Dados vitais importados em lote.');
      return true;
  }

  async enforceVipImmunity() {
      const currentTenant = this.currentTenantId();
      const vipTenants = ['grupo_resolve_hq', 'simbiose_hq']; 
      if (currentTenant && vipTenants.includes(currentTenant)) {
          const config = await this.getItem<AppConfig>('config', 'main_config');
          if (config) {
              config.activePlan = 'PRO_INFINITY'; 
              if(currentTenant === 'grupo_resolve_hq') config.nomeCondominio = 'Solve Prestadora';
              if(currentTenant === 'simbiose_hq') config.nomeCondominio = 'Simbiose Prestadora';
              
              await this.saveItem('config', config);
              this.appConfig.set(config);
          }
      }
  }

  // --- NOVA LÓGICA: BACKUP AUTOMÁTICO SOBRESCRITO (PRESCRIÇÃO) ---
  
  async saveManualBackupToVirtualFolder(isAuto = false, preExportedData?: BackupData) {
      const data = preExportedData || await this.exportData();
      if (this.db) {
          const key = isAuto ? this.AUTO_BACKUP_KEY : Date.now();
          const snapshot = { timestamp: key, data, type: isAuto ? 'AUTO' : 'MANUAL' };
          await this.saveItem('internal_backups', snapshot, false); // Não emite evento para backup
          
          if (!isAuto) {
              const all = await this.getAllFromStore<{timestamp: number}>('internal_backups');
              const manuals = all.filter(b => b.timestamp !== this.AUTO_BACKUP_KEY);
              if (manuals.length > 5) {
                  const sorted = manuals.sort((a,b) => a.timestamp - b.timestamp);
                  await this.deleteItem('internal_backups', sorted[0].timestamp, false);
              }
          }
      }
      
      try {
          const secondary = {
              porteiros: data.porteiros,
              config: data.config,
              exportedAt: data.exportedAt
          };
          localStorage.setItem(this.SECONDARY_BACKUP_KEY, JSON.stringify(secondary));
          this.refreshLastBackupTime();
      } catch { }
  }

  async restoreLatestAutoBackup(): Promise<boolean> {
      if (!this.db) return false;
      const backup = await this.getItem<{data: BackupData}>('internal_backups', this.AUTO_BACKUP_KEY);
      if (backup && backup.data) {
          return await this.processBackupData(backup.data);
      }
      return false;
  }

  async getLatestInternalSnapshot() {
      const all = await this.getAllFromStore<{timestamp: number, data: BackupData}>('internal_backups');
      if (all.length === 0) return null;
      return all.sort((a,b) => b.timestamp - a.timestamp)[0];
  }

  getSecondaryBackupFromLocalStorage(): BackupData | null {
      const raw = localStorage.getItem(this.SECONDARY_BACKUP_KEY);
      return raw ? JSON.parse(raw) : null;
  }

  forceDataReload() { this.reloadSessionData(); }
  forceTrainingDataset(): number { const master = this.MASTER_CARRIERS_DATASET; this.carriers.set(master); localStorage.setItem('learned_carriers', JSON.stringify(master)); return master.length; }
  
  private async initDatabase() {
    if (this.db) return Promise.resolve(); 
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        ['porteiros', 'moradores', 'encomendas', 'logs', 'config', 'internal_backups', 'sys_handles', 'inbox', 'user_credentials'].forEach(store => {
            if (!db.objectStoreNames.contains(store)) {
                const keyPath = store === 'sys_handles' ? 'id' : (store === 'internal_backups' ? 'timestamp' : 'id');
                db.createObjectStore(store, { keyPath });
            }
        });
      };
      request.onsuccess = (event: Event) => { this.db = (event.target as IDBOpenDBRequest).result; resolve(); };
      request.onerror = (event: Event) => { console.error('[DBService] DB Error:', event); reject((event.target as IDBOpenDBRequest).error); }; 
    });
  }
  
  public updateAppConfig(config: Partial<AppConfig>) {
    this.appConfig.update(c => ({ ...c, ...config }));
    this.saveItem('config', this.appConfig());
  }

  public async clearAllStores(): Promise<void> {
    if (!this.db) return Promise.resolve();
    try {
      const storeNames = Array.from(this.db.objectStoreNames);
      const tx = this.db.transaction(storeNames, 'readwrite');
      storeNames.forEach(name => tx.objectStore(name).clear());
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => {
          this.porteiros.set([]); this.moradores.set([]); this.encomendas.set([]); this.logs.set([]); this.inbox.set([]);
          this.appConfig.set({ id: 'main_config', ocrTemperature: 0.3, ocrPromptMode: 'BALANCED', autoCorrectionEnabled: true, googleClientId: '', scannerFPS: 15, activePlan: 'PENDENTE', condoId: crypto.randomUUID(), kioskMode: false, adminFingerprintRegistered: false });
          resolve();
        };
        tx.onerror = () => reject();
      });
    } catch (e) { return Promise.reject(e); }
  }
}
