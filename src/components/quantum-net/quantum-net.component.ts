
import { Component, inject, signal, Injectable, OnInit, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { delay, of } from 'rxjs'; 
import { QuantumNetService, NodeTelemetry } from '../../services/core/quantum-net.service';
import { GeminiService } from '../../services/gemini.service';
import { UiService } from '../../services/ui.service';
import { AuthService } from '../../services/auth.service';
import { DbService, Porteiro } from '../../services/db.service';
import { Router, ActivatedRoute } from '@angular/router';
import { ExclusiveScannerService } from '../../services/exclusive-scanner.service';
import { PdfService } from '../../services/pdf.service';
import { SimbioseHashService } from '../../services/core/simbiose-hash.service';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

// --- [SERVICE] PAYMENT LOGIC (LOCAL CONTEXT) ---
@Injectable({ providedIn: 'root' })
export class SimbiosePaymentService {
  
  gerarPix(plano: string) {
    // PAYLOADS ATUALIZADOS - MERCADO PAGO OFICIAL
    
    if (plano === 'BASICO') {
        return of({
            externalLink: 'https://mpago.li/15wyunC',
            status: "pending"
        }).pipe(delay(800));
    }

    if (plano === 'PRO') {
        return of({
            externalLink: 'https://mpago.li/27yhwgB', 
            status: "pending"
        }).pipe(delay(800));
    }

    if (plano === 'ENTERPRISE') {
        return of({
            externalLink: 'https://mpago.li/1LNPvMv', 
            secondaryLink: 'https://mpago.la/2rht2Tn', 
            secondaryLabel: 'PAGAR NO PIX (20% DE DESCONTO)',
            status: "pending"
        }).pipe(delay(800));
    }
    
    if (plano === 'EXCEDENTE_PRO') {
        return of({
            externalLink: 'https://mpago.li/2nA6uJ1',
            status: "pending"
        }).pipe(delay(800));
    }
    
    // Default Fallback
    return of({
      externalLink: 'https://mpago.li/27yhwgB',
      status: "pending"
    }).pipe(delay(1000));
  }
}

@Component({
  selector: 'app-quantum-net',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './quantum-net.component.html',
  styles: [`
    :host { 
        display: block; 
        width: 100%; 
        min-height: 100vh; 
        background-color: #050505; 
        color: white;
    }
    .neural-dashboard { font-family: 'Courier New', Courier, monospace; }
    
    /* PIANO BLACK & NEON THEME */
    .card-piano {
        background-color: #050505;
        box-shadow: 0 10px 30px rgba(0,0,0,0.8);
        border: 1px solid #1a1a1a;
        transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    .card-piano:hover {
        transform: translateY(-5px);
    }
    
    /* SCROLLBAR */
    .custom-scroll::-webkit-scrollbar { width: 6px; }
    .custom-scroll::-webkit-scrollbar-track { background: #000; }
    .custom-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
  `]
})
export class QuantumNetComponent implements OnInit, OnDestroy {
  qn = inject(QuantumNetService);
  gemini = inject(GeminiService);
  ui = inject(UiService);
  auth = inject(AuthService);
  payment = inject(SimbiosePaymentService);
  db = inject(DbService);
  router = inject(Router);
  route = inject(ActivatedRoute); 
  ocr = inject(ExclusiveScannerService);
  pdf = inject(PdfService);
  hashService = inject(SimbioseHashService);
  sanitizer = inject(DomSanitizer);

  // LOGO MERCADO PAGO - Carregada via URL Externa
  trustedUrl: string = 'https://drive.google.com/uc?export=view&id=1e9yJ-y3L7feMHwKqc3DjxbDtTkSgpz5h';

  // --- SECURITY: ANTI-AUTOFILL RANDOMIZER ---
  randomId = Math.random().toString(36).substring(2);

  constructor() {}

  // Computeds for metrics
  memoryKeysCount = computed(() => Object.keys(this.gemini.getMemory().residentFrequency).length);
  carrierKeysCount = computed(() => Object.keys(this.gemini.getMemory().carrierFrequency).length);
  hasAccess = computed(() => this.auth.hasActiveFeatureAccess());
  isDevMode = computed(() => this.auth.isDevMode());
  
  // Lista de telemetria
  telemetryList = computed(() => {
      const map = this.qn.networkTelemetry();
      return Array.from(map.values()).sort((a: NodeTelemetry, b: NodeTelemetry) => b.usageCount - a.usageCount);
  });
  
  // TARGET TRACKING
  targetSearch = signal('');
  
  filteredTelemetry = computed(() => {
      const search = this.targetSearch().toUpperCase().trim();
      const list = this.telemetryList();
      if (!search) return list;
      return list.sort((a,b) => {
          const aMatch = a.nodeName.toUpperCase().includes(search) || a.nodeId.includes(search);
          const bMatch = b.nodeName.toUpperCase().includes(search) || b.nodeId.includes(search);
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return 0;
      });
  });
  
  // Heartbeat de Telemetria Local
  private telemetryInterval: any;

  showPaymentModal = signal(false);
  etapa = signal(1); 
  planoSelecionado = signal('');
  
  showCondoNameInput = signal(false);
  tempCondoName = '';
  
  // Security Fields
  tempAdminName = '';
  tempAdminCpf = '';
  tempWhatsapp = '';
  acceptedTerms = signal(false);
  
  // --- ONBOARDING WIZARD STATE (GUEST) ---
  showOnboardingModal = signal(false);
  onboardingStep = signal(1); 
  onboardingCondoName = signal('');
  onboardingWhatsapp = signal('');
  onboardingAcceptedTerms = signal(false);
  onboardingAdminName = signal('');
  onboardingAdminCpf = signal('');
  onboardingAdminPassword = signal('');
  
  loading = signal(false);
  pixData = signal<any>(null);
  
  isVerifyingPayment = signal(false);
  
  validationAttempt = signal(0);
  validationTimeLeft = signal(60);
  
  verificationLog = signal<string[]>([]);

  // --- ANTI-AUTOFILL HELPER ---
  removeReadonly(event: any) {
    event.target.removeAttribute('readonly');
  }

  ngOnInit() {
    if (this.qn.status() === 'DESCONECTADO') {
      this.qn.conectarRede();
    }
    this.startTelemetryHeartbeat();
    this.checkPaymentReturn();
  }
  
  async checkPaymentReturn() {
      this.route.queryParams.subscribe(async params => {
          const status = params['collection_status'] || params['status'];
          
          if (status === 'approved') {
              const pendingOnboarding = localStorage.getItem('simbiose_pending_onboarding');
              
              if (pendingOnboarding) {
                  this.ui.show('Pagamento Aprovado! Criando sua conta...', 'SUCCESS');
                  try {
                      const data = JSON.parse(pendingOnboarding);
                      await this.createAdminAccount(data);
                      localStorage.removeItem('simbiose_pending_onboarding');
                  } catch (e) {
                      this.ui.show('Erro ao criar conta. Contate o suporte.', 'ERROR');
                  }
              } else {
                  const pendingPlan = localStorage.getItem('simbiose_pending_plan');
                  if (pendingPlan) {
                      this.planoSelecionado.set(pendingPlan);
                      this.ui.show('Upgrade Confirmado! Ativando...', 'SUCCESS');
                      this.ativarPlanoDefinitivo();
                      localStorage.removeItem('simbiose_pending_plan');
                  }
              }
              
              this.router.navigate([], {
                  queryParams: {
                      'collection_status': null,
                      'status': null,
                      'payment_id': null,
                      'merchant_order_id': null,
                      'preference_id': null,
                      'site_id': null,
                      'processing_mode': null
                  },
                  queryParamsHandling: 'merge'
              });
          }
      });
  }
  
  ngOnDestroy() {
      if (this.telemetryInterval) clearInterval(this.telemetryInterval);
  }
  
  forceNetworkRefresh() {
      this.qn.conectarRede();
      const heartbeat = () => {
          if (this.qn.status() === 'CONECTADO') {
              const user = this.auth.currentUser();
              const config = this.db.appConfig();
              const nodeName = config.nomeCondominio || user?.nome || 'Node Desconhecido';
              
              this.qn.broadcastTelemetry({
                  nodeName: nodeName,
                  plan: this.auth.activePlan(),
                  usageCount: this.auth.usageCount(),
                  planLimit: this.auth.getPlanLimit(),
                  neuralWeight: this.gemini.calculateNeuralWeight()
              });
          }
      };
      heartbeat();
      this.ui.show('Forçando atualização de peers...', 'INFO');
  }
  
  startTelemetryHeartbeat() {
      const heartbeat = () => {
          if (this.qn.status() === 'CONECTADO') {
              const user = this.auth.currentUser();
              const config = this.db.appConfig();
              const nodeName = config.nomeCondominio || user?.nome || 'Node Desconhecido';
              
              this.qn.broadcastTelemetry({
                  nodeName: nodeName,
                  plan: this.auth.activePlan(),
                  usageCount: this.auth.usageCount(),
                  planLimit: this.auth.getPlanLimit(),
                  neuralWeight: this.gemini.calculateNeuralWeight()
              });
          }
      };
      heartbeat(); 
      this.telemetryInterval = setInterval(heartbeat, 15000); 
  }

  triggerTraining() {
    this.ui.show('Iniciando retreinamento local...', 'INFO');
    this.gemini.retrainSimbioseFromDatabase().then(() => {
        this.ui.show('Evolução neural concluída.', 'SUCCESS');
    });
  }

  propagateIntelligence() {
    if (this.qn.status() !== 'CONECTADO') {
        this.ui.show('Conecte-se à rede primeiro.', 'WARNING');
        return;
    }
    const mem = this.gemini.getMemory();
    this.qn.propagarMemoria(mem);
    this.ui.show('Sussurrando Quântico enviado para a rede.', 'SUCCESS');
  }
  
  closeImage() {
      this.ui.closeImage();
  }

  // --- PAYMENT METHODS ---

  iniciarCompra(plano: string) {
    this.planoSelecionado.set(plano);
    
    if (this.auth.isGuestSession()) {
        this.startOnboardingProcess();
        return;
    }

    if (this.auth.currentUser()?.id === 'dev_master_quantum') {
        this.ui.playTone('SUCCESS');
        this.ui.show(`[DEV MASTER] Bypass Financeiro Ativado.`, 'SUCCESS');
        this.ativarPlanoDefinitivo();
        return;
    }

    if (plano === 'START') {
        this.ui.show('Você já está no Plano Grátis.', 'INFO');
        return;
    }

    this.proceedToPaymentFlow(plano);
  }
  
  private proceedToPaymentFlow(plano: string) {
    this.etapa.set(1);
    this.pixData.set(null); 
    this.tempAdminName = this.auth.currentUser()?.nome || '';
    this.tempAdminCpf = this.auth.currentUser()?.cpf || '';
    this.tempWhatsapp = '';
    this.acceptedTerms.set(false);
    
    this.showPaymentModal.set(true);

    if (this.auth.isGuestSession()) {
        this.showCondoNameInput.set(false);
        this.iniciarCheckout();
    } else if (plano === 'BASICO' || plano === 'PRO' || plano === 'ENTERPRISE') {
        this.tempCondoName = this.db.appConfig().nomeCondominio || '';
        this.showCondoNameInput.set(true);
    } else {
        this.showCondoNameInput.set(false);
        this.iniciarCheckout();
    }
  }
  
  // --- ONBOARDING WIZARD ---
  
  startOnboardingProcess() {
      this.onboardingStep.set(1);
      this.onboardingCondoName.set('');
      this.onboardingWhatsapp.set('');
      this.onboardingAcceptedTerms.set(false);
      this.onboardingAdminName.set('');
      this.onboardingAdminCpf.set('');
      this.onboardingAdminPassword.set('');
      this.showOnboardingModal.set(true);
  }
  
  private validateCPFStrict(cpf: string): boolean {
      cpf = cpf.replace(/[^\d]+/g, '');
      if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
      let sum = 0, remainder;
      for (let i = 1; i <= 9; i++) sum = sum + parseInt(cpf.substring(i-1, i)) * (11 - i);
      remainder = (sum * 10) % 11;
      if ((remainder === 10) || (remainder === 11)) remainder = 0;
      if (remainder !== parseInt(cpf.substring(9, 10))) return false;
      sum = 0;
      for (let i = 1; i <= 10; i++) sum = sum + parseInt(cpf.substring(i-1, i)) * (12 - i);
      remainder = (sum * 10) % 11;
      if ((remainder === 10) || (remainder === 11)) remainder = 0;
      if (remainder !== parseInt(cpf.substring(10, 11))) return false;
      return true;
  }
  
  nextOnboardingStep() {
      const step = this.onboardingStep();
      if (step === 1) {
          if (this.onboardingCondoName().trim().length < 3) {
              this.ui.show('Informe o nome do Condomínio/Empresa.', 'WARNING');
              return;
          }
          if (this.onboardingWhatsapp().length < 10) {
              this.ui.show('Informe um WhatsApp válido para suporte.', 'WARNING');
              return;
          }
          if (this.onboardingAdminName().trim().split(' ').length < 2) {
              this.ui.show('Informe o nome completo do administrador.', 'WARNING');
              return;
          }
          const rawCpf = this.onboardingAdminCpf();
          if (!this.validateCPFStrict(rawCpf)) {
              this.ui.show('CPF Inválido. Verifique os dígitos.', 'WARNING');
              this.ui.vibrate([100, 50, 100]); 
              return;
          }
          if (!/^\d{6}$/.test(this.onboardingAdminPassword())) {
              this.ui.show('Senha deve ter 6 números.', 'WARNING');
              return;
          }
          this.onboardingStep.set(2);
      }
      else if (step === 2) {
          if (!this.onboardingAcceptedTerms()) {
              this.ui.show('É necessário aceitar os termos.', 'WARNING');
              return;
          }
          this.savePendingOnboardingAndPay();
      }
  }
  
  prevOnboardingStep() {
      if (this.onboardingStep() > 1) {
          this.onboardingStep.update(v => v - 1);
      } else {
          this.showOnboardingModal.set(false);
      }
  }
  
  savePendingOnboardingAndPay() {
      const pendingData = {
          nomeCondominio: this.onboardingCondoName(),
          whatsapp: this.onboardingWhatsapp(),
          adminName: this.onboardingAdminName(),
          adminCpf: this.onboardingAdminCpf(),
          adminPass: this.onboardingAdminPassword()
      };
      
      localStorage.setItem('simbiose_pending_onboarding', JSON.stringify(pendingData));
      
      this.tempCondoName = pendingData.nomeCondominio;
      this.tempWhatsapp = pendingData.whatsapp;
      this.tempAdminName = pendingData.adminName;
      this.tempAdminCpf = pendingData.adminCpf;
      this.acceptedTerms.set(true); 
      
      this.planoSelecionado.set('PRO');
      this.showOnboardingModal.set(false);
      this.proceedToPaymentFlow('PRO');
  }
  
  async createAdminAccount(data: any) {
      this.ui.show('Configurando sistema...', 'INFO');
      const currentConfig = this.db.appConfig();
      
      const updatedConfig = { 
          ...currentConfig, 
          nomeCondominio: data.nomeCondominio.toUpperCase(),
          activePlan: 'PRO'
      };
      await this.db.saveAppConfig(updatedConfig);
      
      const hashedPass = await this.hashService.hashText(data.adminPass);
      const newAdmin: Porteiro = {
          id: crypto.randomUUID(),
          nome: data.adminName.toUpperCase(),
          cpf: data.adminCpf.replace(/\D/g, ''),
          senha: hashedPass,
          isAdmin: true,
          isDev: false
      };
      
      await this.db.addPorteiro(newAdmin);
      await this.auth.completeLogin(newAdmin, 'PRO');
      sessionStorage.setItem('onboarding_just_completed', 'true');
      
      this.ui.show('Sistema Liberado! Bem-vindo.', 'SUCCESS');
      this.ui.playTone('SUCCESS');
      this.router.navigate(['/dashboard']);
  }
  
  pagarExcedente() {
      this.planoSelecionado.set('EXCEDENTE_PRO');
      this.showPaymentModal.set(true);
      this.iniciarCheckout();
  }
  
  validarDadosEContinuar() {
      if (!this.acceptedTerms()) {
          this.ui.show('Você deve aceitar os termos para continuar.', 'WARNING');
          return;
      }
      if (!this.tempWhatsapp || this.tempWhatsapp.length < 10) {
          this.ui.show('Informe um WhatsApp válido.', 'WARNING');
          return;
      }
      
      const pendingOnboarding = localStorage.getItem('simbiose_pending_onboarding');
      if (pendingOnboarding) {
          const data = JSON.parse(pendingOnboarding);
          data.nomeCondominio = this.tempCondoName;
          data.whatsapp = this.tempWhatsapp;
          localStorage.setItem('simbiose_pending_onboarding', JSON.stringify(data));
      } else {
          const currentConfig = this.db.appConfig();
          const updatedConfig = { ...currentConfig, nomeCondominio: this.tempCondoName.toUpperCase() };
          this.db.saveAppConfig(updatedConfig);
      }

      this.showCondoNameInput.set(false);
      this.iniciarCheckout();
  }

  iniciarCheckout() {
    this.etapa.set(2);
    this.pixData.set(null); 
    this.loading.set(true);
    
    localStorage.setItem('simbiose_pending_plan', this.planoSelecionado());
    
    this.payment.gerarPix(this.planoSelecionado()).subscribe(data => {
        this.pixData.set(data);
        this.loading.set(false);
    });
  }

  voltarParaDados() {
      this.etapa.set(1);
      this.showCondoNameInput.set(true);
  }

  copiarTexto() {
    const val = this.pixData()?.copiaCola;
    if(val) {
        navigator.clipboard.writeText(val);
        this.ui.show('Código PIX copiado!', 'SUCCESS');
    }
  }

  contatarSuporteFalha() {
      const plano = this.planoSelecionado();
      const msg = `Olá, estou com problemas no retorno do pagamento do plano @${plano}.`;
      const url = `https://wa.me/5567984211789?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
  }

  ativarPlanoDefinitivo() {
      if (this.planoSelecionado() === 'EXCEDENTE_PRO') {
          this.auth.bonusLimit.set(this.auth.bonusLimit() + 1000);
          localStorage.setItem('simbiose_bonus_limit', this.auth.bonusLimit().toString());
          this.ui.show('Pacote Extra de 1.000 Etiquetas Ativado!', 'SUCCESS');
      } else {
          this.auth.activePlan.set(this.planoSelecionado());
          
          if (this.auth.currentUser()) {
              const cfg = this.db.appConfig();
              if (this.auth.currentUser()?.id !== 'guest_admin') {
                  this.db.saveAppConfig({ ...cfg, activePlan: this.planoSelecionado() });
              }
          }
          this.ui.show(`Plano ${this.planoSelecionado()} Ativado!`, 'SUCCESS');
          this.ui.playTone('SUCCESS');
          
          if (this.planoSelecionado() === 'ENTERPRISE') {
              this.ui.show('Modo Ilimitado Enterprise Ativo.', 'INFO');
          }
      }
      this.showPaymentModal.set(false);
      this.forceNetworkRefresh();
  }
}
