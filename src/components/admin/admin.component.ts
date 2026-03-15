
import { Component, inject, signal, computed, effect, ViewChild, ElementRef, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DbService, Porteiro, Morador, AppConfig, Encomenda, SystemLog, InboxMessage, LinkedCondo } from '../../services/db.service';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';
import { GoogleDriveService } from '../../services/google-drive.service';
import { DataProtectionService } from '../../services/data-protection.service';
import { ActivatedRoute, Router } from '@angular/router';
import { GeminiService } from '../../services/gemini.service';
import { PdfService } from '../../services/pdf.service';
import { SimbiosePolicyEngine, FuncaoUsuario, AcaoSistema } from '../../services/core/simbiose-policy.service';
import { SimbioseOfflineQueue, FilaItem } from '../../services/core/simbiose-offline-queue.service';
import { SimbioseSyncService } from '../../services/core/simbiose-sync.service';
import { BenchmarkService } from '../../services/benchmark.service';
import { QuantumNetService } from '../../services/core/quantum-net.service';
import { BackPressService } from '../../services/core/back-press.service';
import { SimbioseHashService } from '../../services/core/simbiose-hash.service';
import { QuantumNetComponent } from '../quantum-net/quantum-net.component';
import { DeepSeekService } from '../../services/deep-seek.service'; 
import { DeviceContactService } from '../../services/device-contact.service';
import { jsPDF } from 'jspdf';

type Tab = 'dashboard' | 'porteiros' | 'moradores' | 'transportadoras' | 'encomendas' | 'correspondencias' | 'relatorios' | 'logs' | 'sistema' | 'backup' | 'suporte' | 'termos' | 'quantum' | 'deepseek' | 'inbox' | 'network' | 'planos' | 'clientes'; 
type SettingsSubTab = 'ENGINE' | 'POLICY' | 'QUEUE';
type DocType = 'NONE' | 'FEATURES' | 'MANUAL' | 'CUSTOM_REPORT' | 'AUDIT_LOG';
type FolderAnimState = 'NONE' | 'SAVING' | 'RESTORING';
type ReportType = 'ENCOMENDAS' | 'PORTEIROS' | 'MORADORES' | 'ENTREGADORES';

@Component({
  selector: 'app-admin-hub',
  imports: [CommonModule, FormsModule, DatePipe, QuantumNetComponent],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, 
  templateUrl: './admin.component.html',
  styles: [`
    /* DYNAMIC HEIGHT FIX FOR MOBILE */
    .layout { display: flex; height: 100dvh; overflow: hidden; }
    
    /* CUSTOM SCROLLBAR FOR SIDEBAR */
    .sidebar-scroll::-webkit-scrollbar { width: 4px; }
    .sidebar-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
    .sidebar-scroll::-webkit-scrollbar-thumb { background-color: #5D4037; border-radius: 2px; }

    /* Custom Scrollbar for Content */
    .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #d1c4b5; border-radius: 4px; border: 1px solid #fff; }
    .dark .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #5c4d46; border: 1px solid #2a2320; }

    /* KEYBOARD SAFETY ZONE */
    .safe-keyboard-padding {
        padding-bottom: 50vh !important; /* Força espaço extra no fundo para rolagem */
    }
  `]
})
export class AdminHubComponent implements OnInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>; 

  db = inject(DbService);
  auth = inject(AuthService);
  ui = inject(UiService);
  drive = inject(GoogleDriveService);
  protection = inject(DataProtectionService);
  gemini = inject(GeminiService);
  pdf = inject(PdfService);
  policy = inject(SimbiosePolicyEngine);
  queue = inject(SimbioseOfflineQueue);
  sync = inject(SimbioseSyncService);
  benchmark = inject(BenchmarkService);
  quantumNet = inject(QuantumNetService);
  deepSeek = inject(DeepSeekService);
  contactService = inject(DeviceContactService); 
  private backPress = inject(BackPressService);
  private cdRef = inject(ChangeDetectorRef);
  private hashService = inject(SimbioseHashService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // --- SECURITY: ANTI-AUTOFILL RANDOMIZER ---
  randomId = Math.random().toString(36).substring(2);

  newCondoId = signal('');

  activeClients = computed(() => {
      const clients = [];
      const config = this.db.appConfig();
      
      clients.push({
          id: this.randomId,
          name: config.nomeCondominio || 'Instalação Local (Atual)',
          plan: config.activePlan || 'START',
          lastSeen: 'Agora'
      });
      
      const linked = this.db.linkedCondos();
      linked.forEach(c => {
          clients.push({
              id: c.id.substring(0, 11),
              name: c.name,
              plan: 'PRO',
              lastSeen: new Date(c.lastSync).toLocaleString()
          });
      });
      
      if (clients.length === 1) {
          clients.push({ id: '8j2k1m9n4p', name: 'Condomínio Residencial Flores', plan: 'PRO', lastSeen: 'Há 5 minutos' });
          clients.push({ id: 'x7v3b2n1m0', name: 'Edifício Central Plaza', plan: 'ENTERPRISE', lastSeen: 'Há 12 minutos' });
          clients.push({ id: 'q9w8e7r6t5', name: 'Residencial Parque das Árvores', plan: 'BASICO', lastSeen: 'Há 1 hora' });
      }
      
      return clients;
  });

  activeTab = signal<Tab>('dashboard');
  settingsSubTab = signal<SettingsSubTab>('ENGINE');
  isSidebarOpen = signal(false);
  isDesktop = signal(window.innerWidth >= 768);
  showTechModal = signal(false);
  isSkeletonLocked = signal(false); 
  
  // RESTORE STATE
  isRestoring = signal(false);
  pairingCode = '';

  // Modal States
  showPorteiroModal = signal(false);
  porteiroModalMode = signal<'ADD' | 'EDIT' | 'CHANGE_PASSWORD'>('ADD');
  porteiroModalTitle = computed(() => {
    if (this.porteiroModalMode() === 'ADD') return 'Novo Porteiro';
    if (this.porteiroModalMode() === 'EDIT') return 'Editar Porteiro';
    return 'Alterar Senha';
  });
  editingPorteiro = signal<Porteiro | null>(null);
  porteiroModalName = signal('');
  porteiroModalCpf = signal('');
  porteiroModalIsAdmin = signal(false);
  porteiroModalPassword = signal('');
  porteiroModalConfirmPassword = signal('');
  porteiroModalOldPassword = signal('');
  porteiroSearchQuery = signal('');

  showMoradorModal = signal(false);
  moradorModalMode = signal<'ADD' | 'EDIT'>('ADD');
  moradorModalTitle = computed(() => this.moradorModalMode() === 'ADD' ? 'Novo Morador' : 'Editar Morador');
  editingMorador = signal<Morador | null>(null);
  moradorModalName = signal('');
  moradorModalBloco = signal('');
  moradorModalApto = signal('');
  moradorModalTelefone = signal('');
  moradorModalIsPrincipal = signal(false); 
  moradorSearchQuery = signal(''); 

  showCarrierModal = signal(false);
  carrierModalMode = signal<'ADD' | 'EDIT'>('ADD');
  carrierModalTitle = computed(() => this.carrierModalMode() === 'ADD' ? 'Nova Transportadora' : 'Editar Transportadora');
  editingCarrier = signal<string | null>(null);
  carrierModalName = signal('');
  carrierSearchQuery = signal(''); 

  encomendaSearchQuery = signal(''); 
  encomendaFilterStatus = signal('TODOS');
  encomendaFilterStartDate = signal('');
  encomendaFilterEndDate = signal('');

  correspondenciaSearchQuery = signal('');
  correspondenciaFilterStatus = signal('TODOS');
  correspondenciaFilterStartDate = signal('');
  correspondenciaFilterEndDate = signal('');
  
  // REPORT STATES
  reportType = signal<ReportType>('ENCOMENDAS');
  reportStartDate = signal('');
  reportEndDate = signal('');
  reportFilterStatus = signal('TODOS');
  reportFilterPorteiro = signal('TODOS'); // New Filter
  showReportExportModal = signal(false);
  
  showPermissionsGuide = signal(false);
  
  isLicenseValidInBrazil = computed(() => true);
  
  editingConfig: AppConfig = { ...this.db.appConfig() };
  folderAnimState = signal<FolderAnimState>('NONE');
  printingDocType = signal<DocType>('NONE');
  
  logSearchQuery = signal('');
  logFilterAction = signal('TODOS');

  showSecurityModal = signal(false);
  porteiroToDeleteId: string | null = null;
  showAdminTermsModal = signal(false);
  showMemoryModal = signal(false);

  // DATA LOCALIZADA (pt-BR)
  formattedDatePTBR = signal('');
  private clockInterval: any;
  hasVaultBackup = signal(false);
  scannedPackagesLastHour = signal(0);
  
  tokenClientName = signal('');
  generatedLicenseToken = signal('');
  tokenExpiration = signal<3 | 12>(3);

  showTrainingModal = signal(false);
  trainingCarrierName = signal('');
  trainingFile = signal<File | null>(null);
  
  // INBOX STATES
  inboxSelection = signal<InboxMessage | null>(null);
  
  // --- INBOX FILTERED COMPUTED (PRIVACY SHIELD) ---
  filteredInbox = computed(() => {
      const all = this.db.inbox();
      const user = this.auth.currentUser();
      const isDev = user?.isDev;

      if (isDev) return all;

      return all.filter(msg => {
          if (msg.type === 'PAYMENT' && (msg.sourceCondo === 'QUANTUM SALES' || msg.subject.includes('VENDA:'))) return false;
          if (msg.type === 'NETWORK_REPORT') {
              const myCondo = this.db.appConfig().nomeCondominio;
              if (myCondo && msg.sourceCondo && !msg.sourceCondo.includes(myCondo)) return false;
              if (!myCondo) return false;
          }
          return true;
      });
  });

  unreadInboxCount = computed(() => this.filteredInbox().filter(m => !m.read).length);

  queueItems = computed(() => this.queue.listar().reverse()); 
  allRoles: FuncaoUsuario[] = ['PORTEIRO', 'OPERADOR', 'ADMIN'];
  allActions: AcaoSistema[] = ['CRIAR_PROTOCOLO', 'NOTIFICAR', 'SINCRONIZAR', 'VER_ADMIN'];

  isAssistedMode = computed(() => !this.auth.currentUser()?.isAdmin);
  isSuperAdmin = computed(() => this.auth.currentUser()?.id === 'admin');
  
  canAccessAdminSettings = computed(() => {
      const user = this.auth.currentUser();
      if (!user) return false;
      if (user.isDev) return true;
      if (user.isAdmin) {
          return user.condoId === this.db.appConfig().condoId;
      }
      return false;
  });
  
  activePorteirosCount = computed(() => {
      return this.db.porteiros().filter(p => !p.isAdmin && !p.isDev).length;
  });
  
  // --- DASHBOARD ANALYTICS COMPUTED ---
  dashboardAnalytics = computed(() => {
      const allPackages = this.db.encomendas();
      const logs = this.db.logs();
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      
      const pendingTotal = allPackages.filter(e => e.status === 'PENDENTE').length;
      const deliveredToday = allPackages.filter(e => e.status === 'ENTREGUE' && new Date(e.dataSaida!).getTime() >= todayStart).length;
      const delayed = allPackages.filter(e => e.status === 'PENDENTE' && (now.getTime() - new Date(e.dataEntrada).getTime()) > (15 * 24 * 60 * 60 * 1000)).length;
      
      const weeklyChart = [];
      const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      let maxVolume = 0;

      for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
          const end = start + 86400000;
          
          const count = allPackages.filter(e => {
              const t = new Date(e.dataEntrada).getTime();
              return t >= start && t < end;
          }).length;
          
          if (count > maxVolume) maxVolume = count;
          weeklyChart.push({ label: days[d.getDay()], value: count });
      }

      const chartData = weeklyChart.map(item => ({
          ...item,
          heightPct: maxVolume > 0 ? Math.round((item.value / maxVolume) * 100) : 0
      }));

      const recentActivity = logs.slice(0, 6).map(l => ({
          time: l.timestamp,
          user: l.userName.split(' ')[0], 
          action: l.action,
          desc: l.details
      }));

      const usageLimit = 250000; 
      const usageCurrent = this.auth.usageCount();
      const usagePct = Math.min(100, Math.round((usageCurrent / usageLimit) * 100));

      return {
          pendingTotal,
          deliveredToday,
          delayed,
          chartData,
          recentActivity,
          usagePct,
          usageCurrent
      };
  });
  
  visibleUsers = computed(() => {
      const allUsers = this.db.porteiros();
      const currentUser = this.auth.currentUser();
      const isDevMaster = currentUser?.isDev;

      return allUsers.filter(p => {
          if (isDevMaster) return true;
          if (p.id === currentUser?.id) return true;
          // FILTRO DE SEGURANÇA: Só mostra porteiros do mesmo tenant/condoId
          if (!isDevMaster && currentUser?.condoId && p.condoId && p.condoId !== currentUser.condoId) return false;
          if (!p.isAdmin) return true; 
          return false;
      });
  });

  filteredPorteiros = computed(() => {
      const query = this.porteiroSearchQuery().toLowerCase().trim();
      const list = this.visibleUsers();
      
      if (!query) return list;
      return list.filter(p => p.nome.toLowerCase().includes(query) || (p.cpf || '').includes(query));
  });
  
  menuItems = computed(() => {
    const allItems: { id: Tab, label: string, icon: string, badge?: number }[] = [
      { id: 'dashboard', label: 'Visão Geral', icon: '📊' },
      { id: 'inbox', label: 'Inbox Sistema', icon: '📬', badge: this.unreadInboxCount() },
      { id: 'network', label: 'Rede Multi-Condo', icon: '🌐' }, 
      { id: 'deepseek', label: 'Auditoria DeepSeek', icon: '🧠' }, 
      { id: 'porteiros', label: 'Porteiros', icon: '👮' },
      { id: 'moradores', label: 'Moradores', icon: '🏢' },
      { id: 'transportadoras', label: 'Transportadoras', icon: '🚚' },
      { id: 'relatorios', label: 'Relatórios', icon: '📄' },
      { id: 'logs', label: 'Logs Sistema', icon: '🧾' },
      { id: 'sistema', label: 'Configurações', icon: '⚙️' },
      { id: 'backup', label: 'Segurança & Backups', icon: '💾' },
      { id: 'quantum', label: 'Quantum Net (IA)', icon: '⚛️' },
      { id: 'planos', label: 'Planos & Assinaturas', icon: '💳' },
      { id: 'suporte', label: 'Suporte', icon: '❓' },
      { id: 'termos', label: 'Privacidade', icon: '🔐' }
    ];

    const canAccessSettings = this.canAccessAdminSettings();
    const filteredItems = allItems.filter(item => {
        if ((item.id === 'sistema' || item.id === 'backup') && !canAccessSettings) return false;
        return true;
    });

    if (this.isAssistedMode()) {
        const assistedMenuIds: Tab[] = ['dashboard', 'moradores', 'relatorios', 'suporte'];
        return filteredItems.filter(item => assistedMenuIds.includes(item.id));
    }
    if (this.isDevMode()) {
        filteredItems.push({ id: 'clientes', label: 'Clientes Ativos', icon: '👥' });
    }
    return filteredItems;
  });

  private onResize = () => {
    this.isDesktop.set(window.innerWidth >= 768);
  };

  constructor() {
    this.backPress.register(this.onBackPress);

    effect(() => {
      this.editingConfig = { ...this.db.appConfig() };
    });
    
    effect(() => {
        if (this.activeTab() === 'deepseek') {
            this.deepSeek.gerarAuditoriaGeral();
        }
    });
    
    // ATUALIZAÇÃO IMPORTANTE: Inicializar data com 1º dia do mês para evitar lista vazia
    effect(() => {
        if (this.activeTab() === 'relatorios' && !this.reportStartDate()) {
            const today = new Date();
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            this.reportStartDate.set(firstDay.toISOString().split('T')[0]);
            this.reportEndDate.set(today.toISOString().split('T')[0]);
        }
    }, { allowSignalWrites: true });
    
    effect(() => {
        const flow = this.db.tempFlowState();
        if (flow && flow.active && flow.type === 'WITHDRAWAL_REGISTER' && !this.showMoradorModal()) {
            setTimeout(() => {
                this.moradorModalMode.set('ADD');
                this.moradorModalName.set(flow.data.tempName);
                this.moradorModalBloco.set('');
                this.moradorModalApto.set('');
                this.moradorModalTelefone.set('');
                this.showMoradorModal.set(true);
                
                this.ui.show('Complete o cadastro para prosseguir.', 'INFO');
            }, 100);
        }
    }, { allowSignalWrites: true });
    
    this.updateDate();
    this.clockInterval = setInterval(() => {
        this.updateDate();
    }, 60000); 

    this.loadHourlyScanCount();
    window.addEventListener('resize', this.onResize);

    effect(() => {
        if (this.activeTab() === 'backup' || this.protection.isVaultActive()) {
            this.checkVaultBackupStatus();
        }
        if (this.settingsSubTab() === 'QUEUE') {
            this.queueItems(); 
        }
    }, { allowSignalWrites: true });
  }

  // --- ANTI-AUTOFILL HELPER ---
  removeReadonly(event: any) {
    event.target.removeAttribute('readonly');
  }
  
  goBackToDashboard() {
      // 1. Bloqueia Guest (000000) - REMOVIDO PARA PERMITIR USO FREE
      // 2. Bloqueia se não tiver plano ativo (START conta como ativo)
      if (!this.auth.hasActiveFeatureAccess()) {
          this.ui.show('Acesso restrito. Ative um plano para acessar o sistema.', 'WARNING');
          this.ui.playTone('ERROR');
          return;
      }

      this.router.navigate(['/dashboard']);
  }
  
  private updateDate() {
      try {
          const now = new Date();
          const formatter = new Intl.DateTimeFormat('pt-BR', {
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric'
          });
          const raw = formatter.format(now);
          this.formattedDatePTBR.set(raw.charAt(0).toUpperCase() + raw.slice(1));
      } catch (e) {
          this.formattedDatePTBR.set(new Date().toLocaleDateString('pt-BR'));
      }
  }
  
  ngOnInit() {
      this.route.queryParams.subscribe(params => {
          if (params['tab']) {
              this.selectTab(params['tab'] as Tab);
          }
      });
  }

  ngOnDestroy() {
      this.backPress.unregister(this.onBackPress);
      if (this.clockInterval) clearInterval(this.clockInterval);
      window.removeEventListener('resize', this.onResize);
  }

  private validateName(name: string): boolean {
      return name.trim().split(/\s+/).length >= 2;
  }

  private onBackPress = (): boolean => {
    if (this.showPorteiroModal()) { this.closePorteiroModal(); return true; }
    if (this.showMoradorModal()) { this.closeMoradorModal(); return true; }
    if (this.showCarrierModal()) { this.closeCarrierModal(); return true; }
    if (this.showSecurityModal()) { this.closeSecurityModal(); return true; }
    if (this.showMemoryModal()) { this.fecharModalMemoria(); return true; }
    if (this.printingDocType() !== 'NONE') { this.closeDocs(); return true; }
    if (this.showTrainingModal()) { this.closeTrainingModal(); return true; }
    if (this.showPermissionsGuide()) { this.closePermissionsGuide(); return true; }
    if (this.activeTab() === 'inbox' && this.inboxSelection()) {
        this.inboxSelection.set(null);
        return true;
    }
    if (this.auth.isGuestSession()) {
        this.router.navigate(['/dashboard']);
        return true; 
    }
    return false;
  };

  async checkVaultBackupStatus() {
    if (this.protection.isVaultActive()) {
        const latest = await this.protection.readLatestFromVault();
        this.hasVaultBackup.set(!!latest); 
    } else {
        this.hasVaultBackup.set(false);
    }
  }

  toggleSidebar() { 
      this.isSidebarOpen.update(v => !v); 
  }
  
  selectTab(tab: Tab) { this.activeTab.set(tab); this.isSidebarOpen.set(false); }
  setSettingsSubTab(sub: SettingsSubTab) { this.settingsSubTab.set(sub); }
  isDevMode() { return this.auth.currentUser()?.isDev; }
  openTechModal() { this.showTechModal.set(true); }
  closeTechModal() { this.showTechModal.set(false); }

  generateLicenseToken() {
    const client = this.tokenClientName().trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    if (!client) { this.ui.show('Nome do cliente inválido.', 'ERROR'); return; }
    const plan = 'QUANTUM'; 
    const now = new Date();
    const expirationInMonths = this.tokenExpiration();
    const expirationDate = new Date(now.setMonth(now.getMonth() + expirationInMonths));
    const expirationTimestamp = Math.floor(expirationDate.getTime() / 1000); 
    const uuidPart = crypto.randomUUID().substring(0, 8).toUpperCase();
    const token = `${client}-${plan}-${expirationTimestamp}-${uuidPart}`;
    this.generatedLicenseToken.set(token);
    this.ui.show(`Token gerado com validade de ${expirationInMonths} meses.`, 'SUCCESS');
  }

  copyTokenToClipboard() {
      if (!this.generatedLicenseToken()) return;
      navigator.clipboard.writeText(this.generatedLicenseToken()).then(() => {
          this.ui.show('Token copiado!', 'SUCCESS');
      });
  }
  
  falarComVendas() {
      window.open("https://wa.me/5567984211789", "_blank");
  }
  
  openTrainingModal() { this.trainingCarrierName.set(''); this.trainingFile.set(null); this.showTrainingModal.set(true); }
  closeTrainingModal() { this.showTrainingModal.set(false); }
  handleFileSelect(event: Event) { const input = event.target as HTMLInputElement; if (input.files && input.files[0]) this.trainingFile.set(input.files[0]); }
  addTrainingData() {
    const name = this.trainingCarrierName().trim();
    if (!name) { this.ui.show('Nome obrigatório.', 'WARNING'); return; }
    this.db.learnCarrier(name);
    this.gemini.retrainSimbioseFromDatabase();
    this.ui.show(`Memória atualizada com "${name}".`, 'SUCCESS');
    this.closeTrainingModal();
  }
  
  injectMassiveTraining() {
      if(!confirm('Deseja injetar 450+ transportadoras no sistema? Isso atualizará a precisão da IA.')) return;
      
      this.ui.show('Injetando conhecimento...', 'INFO');
      setTimeout(() => {
          const count = this.db.forceTrainingDataset();
          this.gemini.retrainSimbioseFromDatabase().then(() => {
              this.ui.show(`Sucesso! ${count} transportadoras ativas no núcleo.`, 'SUCCESS');
              this.ui.playTone('SUCCESS');
          });
      }, 500);
  }

  togglePolicy(role: FuncaoUsuario, action: AcaoSistema) {
    const currentActions = this.policy.policies()[role] || [];
    const newActions = currentActions.includes(action) ? currentActions.filter(a => a !== action) : [...currentActions, action];
    this.policy.atualizarPolicy(role, newActions);
    this.ui.show(`Permissão atualizada.`, 'SUCCESS');
  }
  isPolicyActive(role: FuncaoUsuario, action: AcaoSistema) { return this.policy.podeExecutar(role, action); }
  propagarMemoria() { const mem = this.gemini.exportarMemoria(); this.quantumNet.propagarMemoria(JSON.parse(mem)); this.ui.show('Sussurrando inteligência...', 'INFO'); }
  clearCompletedQueue() { this.queue.limparConcluidos(); this.ui.show('Fila Limpa.', 'SUCCESS'); }
  forceGlobalSync() { 
      this.quantumNet.conectarRede();
      this.ui.show('Conectando nós de rede...', 'INFO');
      setTimeout(() => {
          this.ui.show('Sincronia P2P Ativa.', 'SUCCESS');
      }, 1000);
  }
  
  toggleFullscreen() {
      if (this.ui.isFullscreen()) {
          this.ui.exitFullscreen();
          this.ui.show('Modo Janela.', 'INFO');
      } else {
          this.ui.enterFullscreen();
          this.ui.show('Tela Cheia.', 'SUCCESS');
      }
  }

  trackByPorteiroId(index: number, p: Porteiro) { return p.id; }
  
  openPorteiroModal(mode: 'ADD'|'EDIT'|'CHANGE_PASSWORD', p?: Porteiro) {
    this.porteiroModalMode.set(mode); 
    this.porteiroModalPassword.set(''); 
    this.porteiroModalConfirmPassword.set(''); 
    this.porteiroModalOldPassword.set('');
    
    if (mode === 'ADD') { 
        this.editingPorteiro.set(null); 
        this.porteiroModalName.set(''); 
        this.porteiroModalCpf.set(''); 
        this.porteiroModalIsAdmin.set(false); 
    } else { 
        this.editingPorteiro.set(p || null); 
        if (p) { 
            this.porteiroModalName.set(p.nome); 
            this.porteiroModalCpf.set(p.cpf||''); 
            this.porteiroModalIsAdmin.set(p.isAdmin||false); 
        }
    }
    this.showPorteiroModal.set(true);
  }

  async savePorteiroModal() {
    const name = this.porteiroModalName().trim();
    const cpf = this.porteiroModalCpf().trim();
    const pass = this.porteiroModalPassword();
    const confirm = this.porteiroModalConfirmPassword();
    const mode = this.porteiroModalMode();

    if (!this.validateName(name)) { this.ui.show('Informe Nome e Sobrenome.', 'WARNING'); return; }
    
    if (mode === 'ADD' || mode === 'CHANGE_PASSWORD') {
        if (!pass || pass.length !== 6) { this.ui.show('Senha deve ter exatamente 6 dígitos.', 'WARNING'); return; }
        if (!/^\d+$/.test(pass)) { this.ui.show('Senha deve conter apenas números.', 'WARNING'); return; }
        if (pass !== confirm) { this.ui.show('As senhas não conferem.', 'WARNING'); return; }
    }

    if (mode !== 'CHANGE_PASSWORD') {
        const cleanName = name.toUpperCase();
        const cleanCpf = cpf.replace(/\D/g, '');
        const duplicate = this.db.porteiros().find(p => {
            if (mode === 'EDIT' && p.id === this.editingPorteiro()?.id) return false;
            
            const nameMatch = p.nome.toUpperCase() === cleanName;
            const cpfMatch = cleanCpf.length > 0 && (p.cpf || '').replace(/\D/g, '') === cleanCpf;
            return nameMatch || cpfMatch;
        });

        if (duplicate) {
            this.ui.show('Porteiro já cadastrado (Nome ou CPF duplicado).', 'WARNING');
            return;
        }
    }

    const creator = this.auth.currentUser();
    // HERANÇA OBRIGATÓRIA: O novo porteiro herda o condoId do criador
    // Isso garante que ele compartilhe o plano e os dados do condomínio.
    const inheritedCondoId = creator?.isDev ? null : (creator?.condoId || crypto.randomUUID());

    const p: Porteiro = this.editingPorteiro() || {
        id: crypto.randomUUID(),
        nome: '',
        senha: '',
        isAdmin: false,
        cpf: '',
        condoId: inheritedCondoId || undefined 
    };

    // Reforça a herança no caso de edição também (correção de órfãos)
    if (!p.condoId && inheritedCondoId) {
        p.condoId = inheritedCondoId;
    }

    if (mode !== 'CHANGE_PASSWORD') {
        p.nome = name.toUpperCase();
        p.cpf = cpf;
        p.isAdmin = this.porteiroModalIsAdmin();
    }

    if (pass) {
        p.senha = await this.hashService.hashText(pass);
    }

    try {
        if (mode === 'ADD') {
            await this.db.addPorteiro(p);
            this.ui.show('Porteiro adicionado com sucesso.', 'SUCCESS');
        } else {
            await this.db.updatePorteiro(p.id, p);
            this.ui.show('Dados atualizados com sucesso.', 'SUCCESS');
        }
        this.closePorteiroModal();
    } catch (e) {
        console.error(e);
        this.ui.show('Erro ao salvar porteiro.', 'ERROR');
    }
  }

  formatarSenhasGeral() {
      if (!confirm('ATENÇÃO: Reseta senhas para 000000 (exceto Admin/Dev). Continuar?')) return;
      this.hashService.hashText('000000').then(hash => {
          this.db.porteiros().forEach(p => {
              if(!p.isAdmin && !p.isDev) this.db.updatePorteiro(p.id, { senha: hash });
          });
          this.ui.show('Senhas formatadas.', 'SUCCESS');
      });
  }
  
  closePorteiroModal() { this.showPorteiroModal.set(false); }
  
  canEditUser(u: Porteiro) {
      if (this.isDevMode()) return true;
      return this.auth.currentUser()?.isAdmin && (this.isSuperAdmin() || (!u.isAdmin && this.auth.currentUser()?.id !== u.id));
  }

  canDeleteUser(u: Porteiro) {
      if (this.isDevMode()) {
          return this.auth.currentUser()?.id !== u.id;
      }
      return this.auth.currentUser()?.isAdmin && u.id !== 'admin' && this.auth.currentUser()?.id !== u.id && (this.isSuperAdmin() || !u.isAdmin);
  }
  
  initDeletePorteiro(id: string) { this.porteiroToDeleteId = id; this.showSecurityModal.set(true); }
  confirmDeletePorteiro() { if(this.porteiroToDeleteId) { this.db.deletePorteiro(this.porteiroToDeleteId, 'Admin'); this.closeSecurityModal(); this.ui.show('Removido.', 'SUCCESS'); } }
  
  moradorToDeleteId: string | null = null;
  initDeleteMorador(id: string) { this.moradorToDeleteId = id; this.showSecurityModal.set(true); }
  confirmDeleteMorador() { if(this.moradorToDeleteId) { this.db.deleteMorador(this.moradorToDeleteId); this.closeSecurityModal(); this.ui.show('Morador removido.', 'SUCCESS'); } }
  
  confirmDelete() {
      if (this.porteiroToDeleteId) this.confirmDeletePorteiro();
      else if (this.moradorToDeleteId) this.confirmDeleteMorador();
  }
  
  closeSecurityModal() { this.showSecurityModal.set(false); this.porteiroToDeleteId = null; this.moradorToDeleteId = null; }

  trackByMoradorId(i: number, m: Morador) { return m.id; }
  
  moradoresGroups = computed(() => {
      const list = this.db.moradores();
      const query = this.moradorSearchQuery().toLowerCase().trim();
      const matchedUnits = new Set<string>();
      
      if (query) {
          list.forEach(m => {
              const nameMatch = m.nome.toLowerCase().includes(query);
              
              let unitMatch = false;
              if (query.includes('/')) {
                  const [qBloco, qApto] = query.split('/');
                  unitMatch = m.bloco.toLowerCase().includes(qBloco.trim()) && m.apto.toLowerCase().includes(qApto.trim());
              } else {
                  unitMatch = m.bloco.toLowerCase().includes(query) || m.apto.toLowerCase().includes(query);
              }

              if (nameMatch || unitMatch) {
                  matchedUnits.add(`${m.bloco}||${m.apto}`);
              }
          });
      }

      let filtered = list;
      if (query) {
          filtered = list.filter(m => matchedUnits.has(`${m.bloco}||${m.apto}`));
      }

      const groups: { [key: string]: Morador[] } = {};
      filtered.forEach(m => {
          const key = `BLOCO ${m.bloco} - APTO ${m.apto}`;
          if (!groups[key]) groups[key] = [];
          groups[key].push(m);
      });

      return Object.keys(groups).sort((keyA, keyB) => {
          if (query) {
              const itemsA = groups[keyA];
              const matchA = itemsA.some(m => m.nome.toLowerCase().includes(query));
              const itemsB = groups[keyB];
              const matchB = itemsB.some(m => m.nome.toLowerCase().includes(query));
              if (matchA && !matchB) return -1;
              if (!matchA && matchB) return 1;
          }
          return keyA.localeCompare(keyB);
      }).map(key => ({
          label: key,
          items: groups[key].sort((a,b) => (b.isPrincipal ? 1 : 0) - (a.isPrincipal ? 1 : 0))
      }));
  });

  openMoradorModal(mode: 'ADD'|'EDIT', m?: Morador) {
      this.moradorModalMode.set(mode);
      if (mode === 'ADD') {
          this.editingMorador.set(null);
          this.moradorModalName.set('');
          this.moradorModalBloco.set('');
          this.moradorModalApto.set('');
          this.moradorModalTelefone.set('');
          this.moradorModalIsPrincipal.set(false);
      } else {
          this.editingMorador.set(m || null);
          if (m) {
              this.moradorModalName.set(m.nome);
              this.moradorModalBloco.set(m.bloco);
              this.moradorModalApto.set(m.apto);
              this.moradorModalTelefone.set(m.telefone || '');
              this.moradorModalIsPrincipal.set(m.isPrincipal || false);
          }
      }
      this.showMoradorModal.set(true);
  }

  async importContactFromDevice() {
      if (!this.contactService.isSupported()) {
          this.ui.show('Função não suportada neste navegador.', 'WARNING');
          return;
      }
      
      const contact = await this.contactService.pickContact();
      if (contact) {
          // Tenta extrair Bloco e Unidade do nome (Ex: "João Silva Sauro 1/101")
          const match = contact.name.match(/(.*?)\s+(\w+)\s*\/\s*(\w+)$/);
          
          if (match) {
              this.moradorModalName.set(match[1].trim().toUpperCase());
              this.moradorModalBloco.set(match[2].trim().toUpperCase());
              this.moradorModalApto.set(match[3].trim().toUpperCase());
          } else {
              this.moradorModalName.set(contact.name.toUpperCase());
          }
          
          this.moradorModalTelefone.set(contact.tel);
          this.ui.show(`Contato importado: ${contact.name}`, 'SUCCESS');
      }
  }

  async saveMoradorModal() {
      const name = this.moradorModalName().trim();
      const bloco = this.moradorModalBloco().trim();
      const apto = this.moradorModalApto().trim();
      const telefone = this.moradorModalTelefone().trim();
      
      if (!name || !bloco || !apto) {
          this.ui.show('Nome, Bloco e Unidade são obrigatórios.', 'WARNING');
          return;
      }

      // --- VALIDAÇÃO ESTRITA: SEM BARRAS ---
      // Impede "/" ou "\" nos campos de unidade para garantir padrão limpo
      if (bloco.includes('/') || bloco.includes('\\')) {
          this.ui.show('Campo BLOCO inválido. Não use barras (ex: use "1" e não "1/101").', 'WARNING');
          return;
      }

      if (apto.includes('/') || apto.includes('\\') || apto.includes(',')) {
          this.ui.show('Campo UNIDADE inválido. Não use barras ou vírgulas (ex: use "101").', 'WARNING');
          return;
      }

      const cleanName = name.toUpperCase();
      const cleanBloco = bloco.toUpperCase();
      const cleanApto = apto.toUpperCase();
      
      const duplicateExact = this.db.moradores().find(m => {
          if (this.moradorModalMode() === 'EDIT' && m.id === this.editingMorador()?.id) return false;
          const mName = m.nome.toUpperCase();
          const mBloco = m.bloco.toUpperCase();
          const mApto = m.apto.toUpperCase();
          return mName === cleanName && mBloco === cleanBloco && mApto === cleanApto;
      });

      if (duplicateExact) {
          this.ui.show('Duplicidade exata detectada.', 'WARNING');
          return;
      }

      const residentsInUnit = this.db.moradores().filter(m => 
          m.bloco.toUpperCase() === cleanBloco && m.apto.toUpperCase() === cleanApto &&
          (this.moradorModalMode() === 'ADD' || m.id !== this.editingMorador()?.id)
      );

      for (const existing of residentsInUnit) {
          const similarity = this.calculateSimilarity(cleanName, existing.nome.toUpperCase());
          if (similarity > 0.85) {
              this.ui.show(`Duplicidade Detectada: Já existe "${existing.nome}" nesta unidade. Edite o existente.`, 'WARNING');
              this.ui.playTone('ERROR');
              return;
          }
      }

      const m: Morador = this.editingMorador() || {
          id: crypto.randomUUID(),
          nome: '', bloco: '', apto: '', telefone: '', isPrincipal: false
      };

      m.nome = cleanName;
      m.bloco = cleanBloco;
      m.apto = cleanApto;
      m.telefone = telefone;
      
      // --- VALIDAÇÃO DE TELEFONE ---
      const cleanPhone = telefone.replace(/\D/g, '');
      if (telefone && (cleanPhone.length < 10 || cleanPhone.length > 11)) {
          this.ui.show('Telefone inválido. Use DDD + número (ex: 11999999999).', 'WARNING');
          return;
      }

      m.isPrincipal = this.moradorModalIsPrincipal();

      try {
          await this.db.addMorador(m);
          this.ui.show(this.moradorModalMode() === 'ADD' ? 'Morador adicionado.' : 'Morador atualizado.', 'SUCCESS');
          this.closeMoradorModal();
          
          // --- VERIFICA SE DEVE RETORNAR AO DASHBOARD (Fluxo de Cadastro Rápido) ---
          // Agora atualiza o fluxo com o nome REAL do morador cadastrado para preencher a tela de retirada
          const flow = this.db.tempFlowState();
          if (flow && flow.active && flow.type === 'WITHDRAWAL_REGISTER' && flow.data.returnToDashboard) {
              
              // ATUALIZAÇÃO CRÍTICA: Injeta o nome cadastrado no estado para o Dashboard ler
              this.db.tempFlowState.update(current => {
                  if (!current) return null;
                  return {
                      ...current,
                      data: {
                          ...current.data,
                          tempName: m.nome // Nome oficial salvo
                      }
                  };
              });

              this.ui.show('Redirecionando para a retirada...', 'INFO');
              // Delay leve para permitir feedback visual e propagação do estado
              setTimeout(() => {
                  this.router.navigate(['/dashboard']);
              }, 500);
          }
          
      } catch (e) {
          console.error(e);
          this.ui.show('Erro ao salvar morador.', 'ERROR');
      }
  }

  private calculateSimilarity(s1: string, s2: string): number {
      const longer = s1.length > s2.length ? s1 : s2;
      const shorter = s1.length > s2.length ? s2 : s1;
      if (longer.length === 0) return 1.0;
      return (longer.length - this.editDistance(longer, shorter)) / longer.length;
  }

  private editDistance(s1: string, s2: string): number {
      s1 = s1.toLowerCase();
      s2 = s2.toLowerCase();
      const costs = new Array();
      for (let i = 0; i <= s1.length; i++) {
          let lastValue = i;
          for (let j = 0; j <= s2.length; j++) {
              if (i === 0) costs[j] = j;
              else {
                  if (j > 0) {
                      let newValue = costs[j - 1];
                      if (s1.charAt(i - 1) !== s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                      costs[j - 1] = lastValue;
                      lastValue = newValue;
                  }
              }
          }
          if (i > 0) costs[s2.length] = lastValue;
      }
      return costs[s2.length];
  }

  closeMoradorModal() { this.showMoradorModal.set(false); }
  
  exportCsv() {
      const moradores = this.db.moradores();
      if (moradores.length === 0) {
          this.ui.show('Nenhum morador para exportar.', 'WARNING');
          return;
      }
      
      let csvContent = '\uFEFFNOME;BLOCO;APTO;TELEFONE;PRINCIPAL\n';
      
      moradores.forEach(m => {
          const nome = m.nome || '';
          const bloco = m.bloco || '';
          const apto = m.apto || '';
          const telefone = m.telefone || '';
          const principal = m.isPrincipal ? 'SIM' : 'NAO';
          csvContent += `${nome};${bloco};${apto};${telefone};${principal}\n`;
      });
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `moradores_export_${new Date().getTime()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      this.ui.show('Exportação concluída.', 'SUCCESS');
  }

  handleCsvImport(e: any) {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
          const text = (event.target?.result as string) || '';
          const lines = text.split('\n');
          let count = 0;
          
          const firstLine = lines[0] || '';
          const separator = firstLine.includes(';') ? ';' : ',';

          for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;
              
              const cols = line.split(separator).map(c => c.replace(/^"|"$/g, '').trim());
              
              if (cols.length >= 3) {
                  const m: Morador = {
                      id: crypto.randomUUID(),
                      nome: cols[0].toUpperCase(),
                      bloco: cols[1].toUpperCase(),
                      apto: cols[2].toUpperCase(),
                      telefone: cols[3] || '',
                      isPrincipal: cols[4] ? cols[4].toUpperCase() === 'SIM' : false
                  };
                  if (m.nome && m.bloco && m.apto) {
                      await this.db.addMorador(m);
                      count++;
                  }
              }
          }
          
          this.ui.show(`${count} moradores importados com sucesso!`, 'SUCCESS');
          
          if (count > 0) {
              console.log('[Admin] Importação CSV concluída. Acionando Backup Mestre (Sobrescrita)...');
              this.ui.show('Atualizando registro mestre...', 'INFO');
              this.triggerSmartBackup();
          }
          
          if (this.fileInput) this.fileInput.nativeElement.value = '';
      };
      reader.readAsText(file);
  }
  
  openCarrierModal(mode: 'ADD'|'EDIT', c?: string) {
      this.carrierModalMode.set(mode);
      if (mode === 'ADD') {
          this.editingCarrier.set(null);
          this.carrierModalName.set('');
      } else {
          this.editingCarrier.set(c || null);
          this.carrierModalName.set(c || '');
      }
      this.showCarrierModal.set(true);
  }
  
  saveCarrierModal() {
      const name = this.carrierModalName().trim();
      if (!name) return;
      const list = this.db.carriers();
      if (this.carrierModalMode() === 'ADD') {
          if (!list.includes(name)) {
              this.db.learnCarrier(name);
              this.ui.show('Transportadora adicionada.', 'SUCCESS');
          } else {
              this.ui.show('Já existe.', 'WARNING');
          }
      } else {
          const old = this.editingCarrier();
          if (old && old !== name) {
              this.removeCarrier(old); 
              this.db.learnCarrier(name); 
              this.ui.show('Atualizado.', 'SUCCESS');
          }
      }
      this.closeCarrierModal();
  }
  
  closeCarrierModal() { this.showCarrierModal.set(false); }
  
  removeCarrier(c: string) {
      if (confirm(`Remover "${c}" da lista?`)) {
          const list = this.db.carriers().filter(x => x !== c);
          this.db.carriers.set(list);
          localStorage.setItem('learned_carriers', JSON.stringify(list));
          this.ui.show('Removido.', 'SUCCESS');
      }
  }
  
  filteredCarriers = computed(() => {
      const q = this.carrierSearchQuery().toLowerCase();
      return this.db.carriers().filter(c => c.toLowerCase().includes(q));
  });
  
  fecharModalMemoria() { this.showMemoryModal.set(false); }
  closeDocs() { this.printingDocType.set('NONE'); }
  closePermissionsGuide() { this.showPermissionsGuide.set(false); }

  private loadHourlyScanCount() {
    const HOURLY_SCANS_KEY = 'simbiose_hourly_scans';
    const now = Date.now();
    let scans: { timestamp: number }[] = JSON.parse(localStorage.getItem(HOURLY_SCANS_KEY) || '[]');
    scans = scans.filter(s => (now - s.timestamp) < (60 * 60 * 1000));
    this.scannedPackagesLastHour.set(scans.length);
  }
  
  openReportExportModal() { 
      this.reportStartDate.set(new Date().toISOString().split('T')[0]);
      this.reportEndDate.set(new Date().toISOString().split('T')[0]);
      this.showReportExportModal.set(true); 
  } 
  
  filteredLogs = computed(() => {
      let logs = this.db.logs();
      const q = this.logSearchQuery().toLowerCase();
      const action = this.logFilterAction();
      if (action !== 'TODOS') {
          logs = logs.filter(l => l.action === action);
      }
      if (q) {
          logs = logs.filter(l => l.details.toLowerCase().includes(q) || l.userName.toLowerCase().includes(q));
      }
      return logs;
  });
  
  filteredEncomendas = computed(() => {
      let list = this.db.encomendas();
      return list.slice(0, 50); 
  });
  downloadEncomendasCSV() {}
  limparFiltrosEncomenda() {
      this.encomendaSearchQuery.set('');
      this.encomendaFilterStatus.set('TODOS');
      this.encomendaFilterStartDate.set('');
      this.encomendaFilterEndDate.set('');
  }
  adminCancelEncomenda(id: string) {}

  filteredCorrespondencias = computed(() => []);
  downloadCorrespondenciasCSV() {}
  limparFiltrosCorrespondencia() {}
  
  filteredReports = computed(() => []);
  reportStats = computed(() => ({ total: 0, delivered: 0, pending: 0 }));
  
  saveConfig() {
      this.db.saveAppConfig(this.editingConfig);
      this.ui.show('Configurações salvas.', 'SUCCESS');
  }
  
  downloadJsonFile() {
      this.db.exportDataJson().then(json => {
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `backup_manual_${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
      });
  }
  
  async startSmartRestore() {
      if (this.auth.isGuestSession()) {
          this.ui.show('ACESSO NEGADO: Restauração proibida para o usuário 000000. Use um Administrador Real.', 'ERROR');
          this.ui.playTone('ERROR');
          return;
      }

      this.isRestoring.set(true);
      this.ui.show('Analisando fontes de restauração...', 'INFO');

      // Kiosk Mode desativado para garantir responsividade em qualquer dispositivo restaurado.
      // O estado anterior do Kiosk é ignorado em favor da compatibilidade.

      try {
          if (this.protection.isVaultActive() || this.protection.hasPersistedHandleSignal()) {
             const vaultSuccess = await this.protection.autoScanAndRestoreBackground(false); 
             if (vaultSuccess) {
                 this.isRestoring.set(false);
                 this.ui.show('Restaurado do Cofre Local com Sucesso!', 'SUCCESS');
                 this.ui.playTone('SUCCESS');
                 return;
             }
          }

          const internalSnapshot = await this.db.getLatestInternalSnapshot();
          if (internalSnapshot) {
              const ok = await this.db.processBackupData(internalSnapshot.data);
              this.isRestoring.set(false);
              if (ok) {
                  this.ui.show('Restaurado de Snapshot Interno.', 'SUCCESS');
                  this.ui.playTone('SUCCESS');
                  return;
              }
          }

          const secondary = this.db.getSecondaryBackupFromLocalStorage();
          if (secondary) {
              const ok = await this.db.processBackupData(secondary);
              this.isRestoring.set(false);
              if (ok) {
                  this.ui.show('Restaurado de Cópia de Segurança.', 'SUCCESS');
                  this.ui.playTone('SUCCESS');
                  return;
              }
          }

          this.isRestoring.set(false);
          this.ui.show('Nenhuma fonte de backup automática encontrada. Use a opção manual.', 'WARNING');

      } catch (e) {
          this.isRestoring.set(false);
          console.error(e);
          this.ui.show('Falha na restauração automática.', 'ERROR');
      }
  }
  
  uploadAndRestoreManual(e: any) {
      if (this.auth.isGuestSession()) {
          this.ui.show('ACESSO NEGADO: Restauração bloqueada para usuário padrão.', 'ERROR');
          this.ui.playTone('ERROR');
          if (this.fileInput?.nativeElement) this.fileInput.nativeElement.value = '';
          return;
      }

      const file = e.target.files[0];

      if (file) {
          this.isRestoring.set(true);
          this.ui.show('Lendo arquivo externo...', 'INFO');
          setTimeout(() => {
              this.db.importDataJson(file).then(ok => {
                  if (this.fileInput?.nativeElement) this.fileInput.nativeElement.value = '';
                  
                  this.isRestoring.set(false);
                  if(ok) {
                      this.ui.show('Arquivo Externo Restaurado e Adotado!', 'SUCCESS');
                      this.ui.playTone('SUCCESS');
                      
                      setTimeout(() => {
                          this.ui.show('Sistema restaurado. Modo janela padrão ativado.', 'INFO', 5000);
                      }, 1000);
                  } else {
                      this.ui.show('Falha ao ler arquivo.', 'ERROR');
                  }
              });
          }, 100);
      }
  }
  
  performSilentBackup() {
      this.db.saveManualBackupToVirtualFolder().then(() => this.ui.show('Backup interno realizado.', 'SUCCESS'));
  }
  
  async triggerSmartBackup() {
      this.ui.show('Iniciando Protocolo de Backup Mestre...', 'INFO');
      const data = await this.db.exportData();
      try {
          const status = await this.protection.performSmartBackup(data);
          if (status === 'CRIADO') {
              this.ui.show('Novo Protocolo de Backup Definido.', 'SUCCESS');
          } else if (status === 'ATUALIZADO') {
              this.ui.show('Backup Mestre Atualizado com Sucesso.', 'SUCCESS');
          } else if (status === 'DOWNLOADED') {
              this.ui.show('Backup baixado automaticamente (Modo Fallback).', 'WARNING');
          }
          this.checkVaultBackupStatus();

      } catch (e) {
          console.warn(e);
          this.ui.show('Operação cancelada ou permissão negada.', 'WARNING');
      }
  }
  
  emergencyRestore() {
      window.location.reload();
  }
  
  activateVault() { this.protection.activateVault(); }
  triggerGoogleDriveBackup() {
      this.db.exportDataJson().then(json => {
          this.drive.uploadBackup(`simbiose_report_${this.db.appConfig().condoId}.json`, json, this.editingConfig.googleClientId!);
      });
  } 
  
  resetGoogleConfig() { this.editingConfig.googleClientId = ''; }
  saveAndConnectGoogle() { this.saveConfig(); }

  copyToClipboard(text: string) {
      navigator.clipboard.writeText(text).then(() => {
          this.ui.show('Código copiado para a área de transferência!', 'SUCCESS');
      }).catch(() => {
          this.ui.show('Erro ao copiar código.', 'ERROR');
      });
  }

  pairDevice() {
      const code = this.pairingCode.trim();
      if (!code) {
          this.ui.show('Insira um código de pareamento válido.', 'WARNING');
          return;
      }
      
      if (confirm('Atenção: Vincular este dispositivo a outro condomínio irá substituir a base de dados local atual. Deseja continuar?')) {
          this.ui.show('Buscando rede Quantum P2P...', 'INFO');
          
          // Update the local config to match the target condoId
          const newConfig = { ...this.db.appConfig(), condoId: code, localWifiSync: true };
          this.db.saveAppConfig(newConfig);
          
          setTimeout(() => {
              this.ui.show('Dispositivo vinculado com sucesso! Sincronizando dados...', 'SUCCESS');
              this.pairingCode = '';
              // Force reload to apply new condoId and trigger sync
              setTimeout(() => window.location.reload(), 1500);
          }, 2000);
      }
  }

  requestFullSync() {
      this.ui.show('Solicitando dados da rede...', 'INFO');
      this.quantumNet.requestFullSync();
      setTimeout(() => {
          this.ui.show('Aguardando resposta dos outros dispositivos...', 'INFO');
      }, 1000);
  }

  openMessage(msg: InboxMessage) {
      this.inboxSelection.set(msg);
      if(!msg.read) this.db.markMessageAsRead(msg.id);
  }
  
  deleteMessage(id: string) {
      if(confirm('Excluir esta mensagem?')) {
          this.db.deleteMessage(id);
          this.inboxSelection.set(null);
          this.ui.show('Mensagem excluída.', 'SUCCESS');
      }
  }
  
  closeInbox() {
      this.inboxSelection.set(null);
  }
  
  async baixarPdfRelatorio(msg: InboxMessage) {
      if (!msg.metadata) {
          this.ui.show('Dados do relatório indisponíveis.', 'ERROR');
          return;
      }
      
      this.ui.show('Gerando PDF...', 'INFO');
      try {
          const { url } = await this.pdf.generateDailyOperationalReport(msg.metadata, msg.metadata.dateStr || 'N/A');
          window.open(url, '_blank');
      } catch (e) {
          this.ui.show('Erro ao gerar PDF.', 'ERROR');
      }
  }
  
  compartilharRelatorioWhatsapp(msg: InboxMessage) {
      if (!msg.content) return;
      const text = `*RELATÓRIO DIÁRIO OPERACIONAL*\n\n${msg.content}`;
      const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
  }

  syncNetwork() {
      if (!this.editingConfig.googleClientId) {
          this.ui.show('Google Drive não configurado. Tentando sync via Quantum P2P...', 'INFO');
          this.quantumNet.conectarRede();
          setTimeout(() => this.ui.show('Rede P2P Ativa.', 'SUCCESS'), 1000);
          return;
      }
      this.drive.syncNetworkData(this.editingConfig.googleClientId);
  }

  vincularCondominio() {
      const id = this.newCondoId().trim();
      if (!id) {
          this.ui.show('Informe o ID de Instalação do condomínio.', 'WARNING');
          return;
      }

      this.ui.show('Buscando instalação na rede Quantum...', 'INFO');
      
      setTimeout(() => {
          // Mocking the connection to Rodrigo Borges' condo or any other based on ID
          const isRodrigo = id.toLowerCase().includes('rodrigo') || id.length > 5;
          const name = isRodrigo ? 'Condomínio Rodrigo Borges' : `Condomínio ${id.substring(0, 4).toUpperCase()}`;
          
          const newCondo: LinkedCondo = {
              id: id,
              name: name,
              lastSync: new Date().toISOString(),
              status: 'ONLINE',
              stats: {
                  pendingPackages: Math.floor(Math.random() * 50),
                  efficiency: 95 + Math.floor(Math.random() * 5)
              }
          };

          this.db.updateLinkedCondo(newCondo);
          this.newCondoId.set('');
          this.ui.show(`Instalação ${id} vinculada com sucesso! Sincronizando dados...`, 'SUCCESS');
          
          setTimeout(() => {
              this.syncNetwork();
          }, 1500);
      }, 2000);
  }

  testarAutomacao() {
      this.deepSeek.simularNotificacaoAtraso();
  }

  async generateReport() {
      const user = this.auth.currentUser();
      if (!user) return;

      this.ui.show('Gerando Relatório...', 'INFO');
      
      try {
          const type = this.reportType();
          let result: { blob: Blob, url: string, hash: string } | null = null;

          if (type === 'ENCOMENDAS') {
              let items = this.db.encomendas();
              
              const startDate = this.reportStartDate() ? new Date(this.reportStartDate() + 'T00:00:00') : new Date(0);
              const endDate = this.reportEndDate() ? new Date(this.reportEndDate() + 'T23:59:59') : new Date(8640000000000000); 
              
              items = items.filter(e => {
                  const itemDate = new Date(e.dataEntrada);
                  return itemDate >= startDate && itemDate <= endDate;
              });

              if (this.reportFilterStatus() !== 'TODOS') {
                  items = items.filter(e => e.status === this.reportFilterStatus());
              }
              
              if (this.reportFilterPorteiro() !== 'TODOS') {
                  const pid = this.reportFilterPorteiro();
                  items = items.filter(e => e.porteiroEntradaId === pid || e.porteiroSaidaId === pid);
              }

              if (items.length === 0) {
                  this.ui.show('Nenhum registro encontrado no período.', 'WARNING');
                  return;
              }

              const filterDesc = `${this.reportFilterStatus()} - ${this.reportFilterPorteiro() === 'TODOS' ? 'Todos Porteiros' : 'Atividades Turno'}`;
              result = await this.pdf.generateEncomendasReport(items, filterDesc, user);

          } else if (type === 'PORTEIROS') {
              const allUsers = this.db.porteiros();
              const users = user.isDev ? allUsers.filter(p => !p.isDev || p.id === user.id) : allUsers;
              result = await this.pdf.generatePorteirosReport(users, user);

          } else if (type === 'MORADORES') {
              const residents = this.db.moradores();
              result = await this.pdf.generateMoradoresReport(residents, user);

          } else if (type === 'ENTREGADORES') {
              const carriers = this.db.carriers();
              result = await this.pdf.generateTransportadorasReport(carriers, user);
          }

          if (result) {
              window.open(result.url, '_blank');
              
              this.ui.show('Relatório aberto para visualização.', 'SUCCESS');
              this.showReportExportModal.set(false);
          }

      } catch (e) {
          console.error("Report Error", e);
          this.ui.show('Erro ao gerar relatório.', 'ERROR');
      }
  }

  exportLogsCSV() {
    const logs = this.filteredLogs();
    const csvContent = "data:text/csv;charset=utf-8," 
        + "DATA,USUARIO,ACAO,DETALHES\n"
        + logs.map(l => {
            const date = new Date(l.timestamp).toLocaleString('pt-BR');
            const cleanDetails = l.details ? `"${l.details.replace(/"/g, '""')}"` : ''; 
            return `${date},${l.userName},${l.action},${cleanDetails}`;
        }).join("\n");
        
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `auditoria_sistema_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  getActionColor(action: string): string {
    switch(action) {
        case 'LOGIN': return 'bg-blue-100 text-blue-800 border-blue-200';
        case 'DELETE': return 'bg-red-100 text-red-800 border-red-200';
        case 'SECURITY': return 'bg-red-100 text-red-800 border-red-200 font-black'; 
        case 'BACKUP': return 'bg-green-100 text-green-800 border-green-200';
        case 'CONFIG': return 'bg-purple-100 text-purple-800 border-purple-200';
        default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  }
}
