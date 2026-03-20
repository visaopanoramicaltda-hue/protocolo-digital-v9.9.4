
import { Injectable, signal, inject } from '@angular/core';
import { UiService } from './ui.service';
import { DbService } from './db.service';
import { SimbioseHashService } from './core/simbiose-hash.service';

export interface CryptoBlock {
  index: number;
  timestamp: string;
  merkleRoot: string;
  previousHash: string;
  actionType: string;
  difficulty: number;
  nonce: number;
  hash: string;
}

export interface SecureBackupWrapper {
  magic: 'BITCOIN_SECURE_LEDGER';
  version: number;
  timestamp: string;
  previousLedgerHash: string;
  merkleRoot: string;
  nonce: number;
  difficulty: number;
  hash: string;
  payload: string;
}

// Interface helper for File System Access API permissions
interface FileSystemHandleWithPermissions {
  queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}

@Injectable({
  providedIn: 'root'
})
export class DataProtectionService {
  private ui = inject(UiService);
  private db = inject(DbService);
  private crypto = inject(SimbioseHashService);
  
  // State
  isVaultActive = signal(false);
  hasPersistedHandleSignal = signal(false); // Flag para indicar que existe um cofre conhecido
  ledger = signal<CryptoBlock[]>([]);
  isFileSystemSupported = signal(false);

  // Web File System Access API handles
  private vaultHandle: FileSystemDirectoryHandle | null = null;
  private masterFileHandle: FileSystemFileHandle | null = null; // Handle para o Backup Mestre (Arquivo Único)

  private readonly DIFFICULTY = 2; 
  private readonly BACKUP_DIFFICULTY = 3; 
  private readonly VAULT_HANDLE_KEY = 'persistent_vault_handle';
  private readonly MASTER_BACKUP_HANDLE_KEY = 'persistent_master_backup_handle';
  private readonly MASTER_FILENAME = 'Simbiose_Master_Data.json';

  // --- PROPRIEDADE INTELECTUAL (CREDENCIAL MESTRA) ---
  private readonly OWNER_DNA = {
    nome: "João Paulo dos Santos Machado",
    cpf_root: "90062306101", // ATUALIZADO: Prefixo reflete a nova senha
    dna_seeds: ["Laryssa", "Ayla", "Rayssa"], 
    signature: "MASTER_DEV_V5_QUANTUM",
    validade_dna: "20/12/2025"
  };

  isLicenseValid = signal(true); 
  
  constructor() {
    this.restoreLedger();
    this.checkFileSystemSupport();
    // Try to load persisted handles silently on init
    setTimeout(() => this.tryLoadPersistedHandle(), 1000);
  }

  public validateMasterPin(pin: string): boolean {
      const masterKey = this.OWNER_DNA.cpf_root.substring(0, 6);
      return pin === masterKey;
  }

  public getDevCredentials() {
      return {
          id: 'dev_master_quantum',
          nome: 'JOÃO PAULO (DEV MASTER)',
          cpf: '035.***.061-**',
          senha: '900623', // ATUALIZADO
          isAdmin: true,
          isDev: true
      };
  }

  async getStorageEstimate(): Promise<{usage: number, quota: number}> {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return { usage: estimate.usage || 0, quota: estimate.quota || 0 };
    }
    return { usage: 0, quota: 0 };
  }

  public async auditoriaIp() {
    if (!navigator.onLine) return;
    try {
        await fetch('https://api.ipify.org?format=json');
        this.isLicenseValid.set(true);
    } catch {}
  }

  private checkFileSystemSupport() {
    // Check basic support, but actual capability depends on context (iframe vs top window)
    this.isFileSystemSupported.set('showDirectoryPicker' in window);
  }

  // --- SMART BACKUP (MASTER FILE OVERWRITE LOGIC) ---
  
  /**
   * Executa o backup inteligente com Criptografia AES-256.
   * Se já temos o handle do arquivo, sobrescreve (ATUALIZADO).
   * Se não, pede para criar/selecionar (CRIADO).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async performSmartBackup(data: unknown): Promise<'CRIADO' | 'ATUALIZADO' | 'DOWNLOADED'> {
      const rawContent = JSON.stringify(data);
      
      // CRIPTOGRAFIA AES-256 ANTES DE SALVAR
      // Garante que o arquivo no disco esteja sempre protegido
      const encryptedPacket = await this.crypto.encryptData(rawContent);
      const finalContent = JSON.stringify(encryptedPacket, null, 2);
      
      try {
          // Tenta recuperar handle se estiver nulo (persistence check)
          if (!this.masterFileHandle) {
              const persisted = await this.db.getItem<{id: string, handle: FileSystemFileHandle}>('sys_handles', this.MASTER_BACKUP_HANDLE_KEY);
              if (persisted && persisted.handle) {
                  this.masterFileHandle = persisted.handle;
              }
          }

          if (this.masterFileHandle) {
              // --- MODO ATUALIZAÇÃO (Sobrescreve o arquivo existente) ---
              const opts = { mode: 'readwrite' as const };
              
              const handle = this.masterFileHandle as unknown as FileSystemHandleWithPermissions;
              if ((await handle.queryPermission(opts)) !== 'granted') {
                  if ((await handle.requestPermission(opts)) !== 'granted') {
                      this.masterFileHandle = null; 
                      return this.performSmartBackup(data); 
                  }
              }
              
              await this.writeAtomic(this.masterFileHandle, finalContent);
              return 'ATUALIZADO';
          } else {
              // --- MODO CRIAÇÃO (Salva o primeiro arquivo fixo) ---
              this.masterFileHandle = await (window as unknown as { showSaveFilePicker: (options: Record<string, unknown>) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
                  suggestedName: this.MASTER_FILENAME, 
                  types: [{
                      description: 'Backup Seguro Simbiose (AES-256)',
                      accept: { 'application/json': ['.json'] },
                  }],
              });
              
              // Persiste o Handle para futuras sessões
              await this.db.saveItem('sys_handles', { id: this.MASTER_BACKUP_HANDLE_KEY, handle: this.masterFileHandle });
              
              await this.writeAtomic(this.masterFileHandle, finalContent);
              return 'CRIADO';
          }
      } catch (erro: unknown) {
          if ((erro as Error).name === 'AbortError') return 'DOWNLOADED';

          // Fallback para download legado (Arquivo Encriptado)
          console.warn('[SmartBackup] Ambiente restrito. Usando Download Legado (Encriptado).');
          this.triggerLegacyDownload(finalContent);
          return 'DOWNLOADED';
      }
  }

  private triggerLegacyDownload(content: string) {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Simbiose_Master_Data_Secure.json`; // Nome indica que é seguro
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  }

  private async writeAtomic(fileHandle: FileSystemFileHandle, content: string) {
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
  }

  // --- VAULT PERSISTENCE (AUTO-RESTORE) ---

  public async tryLoadPersistedHandle() {
      try {
          if (!this.db.initialized()) {
              await new Promise(resolve => setTimeout(resolve, 500));
          }

          const vaultRecord = await this.db.getItem<{id: string, handle: FileSystemDirectoryHandle}>('sys_handles', this.VAULT_HANDLE_KEY);
          if (vaultRecord && vaultRecord.handle) {
              this.vaultHandle = vaultRecord.handle;
              this.hasPersistedHandleSignal.set(true); 
              
              const perm = await this.verifyPermission(this.vaultHandle, false);
              if (perm) {
                  this.isVaultActive.set(true);
              }
          }

          const masterRecord = await this.db.getItem<{id: string, handle: FileSystemFileHandle}>('sys_handles', this.MASTER_BACKUP_HANDLE_KEY);
          if (masterRecord && masterRecord.handle) {
              this.masterFileHandle = masterRecord.handle;
          }

      } catch {}
  }

  async verifyPermission(fileHandle: FileSystemDirectoryHandle, withUserGesture: boolean) {
    const options = { mode: 'readwrite' as const };
    const handle = fileHandle as unknown as FileSystemHandleWithPermissions;
    if ((await handle.queryPermission(options)) === 'granted') return true;
    if (withUserGesture) {
        try {
            const result = await handle.requestPermission(options);
            return result === 'granted';
        } catch { return false; }
    }
    return false;
  }

  async activateVault() {
    if (!('showDirectoryPicker' in window)) {
      this.ui.show('Navegador não suporta acesso a pastas locais.', 'INFO');
      return;
    }

    try {
      this.vaultHandle = await (window as unknown as { showDirectoryPicker: (options: Record<string, unknown>) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ 
          id: 'simbiose-secure-vault', 
          mode: 'readwrite' 
      });
      
      if(this.vaultHandle) {
          await this.db.saveItem('sys_handles', { id: this.VAULT_HANDLE_KEY, handle: this.vaultHandle });
          this.isVaultActive.set(true);
          this.hasPersistedHandleSignal.set(true);
          this.ui.show('🔓 Cofre Local Ativado!', 'SUCCESS');
          
          const data = await this.db.exportData();
          // Salva versão encriptada
          const encrypted = await this.crypto.encryptData(JSON.stringify(data));
          await this.writeToVault(this.MASTER_FILENAME, JSON.stringify(encrypted, null, 2));
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
          this.ui.show('Falha ao ativar Cofre.', 'ERROR');
      }
      this.isVaultActive.set(false);
    }
  }

  async autoScanAndRestoreBackground(interactive: boolean = false): Promise<boolean> {
      if (!this.vaultHandle) await this.tryLoadPersistedHandle();
      if (!this.vaultHandle) return false;

      const hasPerm = await this.verifyPermission(this.vaultHandle, interactive);
      if (!hasPerm) return false;

      this.isVaultActive.set(true);

      try {
          let targetFile: FileSystemFileHandle | null = null;
          
          // Tenta ler o Mestre
          try {
              targetFile = await this.vaultHandle.getFileHandle(this.MASTER_FILENAME);
          } catch {
              console.log('[Vault] Arquivo mestre não encontrado.');
          }

          if (targetFile) {
              if (interactive) this.ui.show('Descriptografando Cofre...', 'INFO');
              
              const file = await targetFile.getFile();
              const text = await file.text();
              let data;
              
              // TENTA DESCRIPTOGRAFAR
              try {
                  const json = JSON.parse(text);
                  // Verifica assinatura de criptografia
                  if (json.v && json.iv && json.data) {
                      const decryptedString = await this.crypto.decryptData(json);
                      data = JSON.parse(decryptedString);
                  } else {
                      // Fallback para legado (texto plano)
                      data = json;
                  }
              } catch {
                  if (interactive) this.ui.show('Senha incorreta ou arquivo corrompido.', 'ERROR');
                  return false;
              }

              const success = await this.db.processBackupData(data);
              if (success) {
                  if (interactive) this.ui.show('Dados restaurados com sucesso.', 'SUCCESS');
                  return true;
              }
          }
      } catch {
          if (interactive) this.ui.show('Erro ao ler Cofre.', 'ERROR');
      }
      return false;
  }

  // --- BLOCKCHAIN CORE (UNCHANGED) ---
  
  private async sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private canonicalStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return JSON.stringify(obj.map(item => JSON.parse(this.canonicalStringify(item))));
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    sortedKeys.forEach(key => result[key] = JSON.parse(this.canonicalStringify(obj[key])));
    return JSON.stringify(result);
  }

  async mineBlock(data: Record<string, unknown>, actionType: string): Promise<CryptoBlock> {
    const currentChain = this.ledger();
    const prevHash = currentChain.length > 0 ? currentChain[currentChain.length - 1].hash : '0000000000000000000000000000000000000000000000000000000000000000';
    const index = currentChain.length + 1;
    const timestamp = new Date().toISOString();
    const merkleRoot = await this.sha256(this.canonicalStringify(data));

    let nonce = 0;
    let hash = '';
    const target = Array(this.DIFFICULTY + 1).join("0");
    let solved = false;

    while (!solved) {
      const payload = `${index}${prevHash}${timestamp}${merkleRoot}${nonce}${this.DIFFICULTY}`;
      hash = await this.sha256(payload);
      if (hash.substring(0, this.DIFFICULTY) === target) solved = true;
      else nonce++;
      if(nonce > 100000) break; 
    }

    const newBlock: CryptoBlock = {
      index, timestamp, merkleRoot, previousHash: prevHash, actionType, difficulty: this.DIFFICULTY, nonce, hash
    };

    this.ledger.update(chain => [...chain, newBlock]);
    this.saveLedgerLocal();
    
    return newBlock;
  }

  private saveLedgerLocal() {
    localStorage.setItem('protocolo_blockchain_ledger', JSON.stringify(this.ledger()));
  }

  private restoreLedger() {
    const saved = localStorage.getItem('protocolo_blockchain_ledger');
    if (saved) this.ledger.set(JSON.parse(saved));
  }

  async syncDataToVault(filename: string, data: Record<string, unknown>) {
    if (!this.isVaultActive()) return;
    // Encripta antes de salvar no cofre
    const encrypted = await this.crypto.encryptData(JSON.stringify(data));
    await this.writeToVault(filename, JSON.stringify(encrypted, null, 2));
  }

  public async writeToVault(filename: string, content: string) {
    if (!this.vaultHandle) return;
    try {
      const fileHandle = await this.vaultHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
    } catch {}
  }
  
  public async readLatestFromVault(): Promise<{data: string, timestamp: string} | null> {
    if (!this.vaultHandle) return null;
    try {
        const fileHandle = await this.vaultHandle.getFileHandle(this.MASTER_FILENAME);
        const file = await fileHandle.getFile();
        // Não lemos o conteúdo inteiro para não pesar, apenas confirmamos existência e timestamp.
        // O status "BLINDADO" depende apenas de o arquivo existir e ser acessível.
        return { data: 'PROTECTED', timestamp: file.lastModified.toString() }; 
    } catch {
        // Se falhar (arquivo não existe ou sem permissão), retorna null para status EXPOSTO.
        return null; 
    }
  }
}
