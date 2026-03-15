
import { Injectable, inject, signal, effect, computed, Injector } from '@angular/core';
import { DbService, Porteiro, AppConfig } from './db.service';
import { Router } from '@angular/router';
import { UiService } from './ui.service';
import { DataProtectionService } from './data-protection.service';
import { SimbioseHashService } from './core/simbiose-hash.service';

export interface LicenseDetails {
  plano: 'START' | 'BASICO' | 'PRO' | 'ENTERPRISE' | 'DEV_SUPREMO' | 'PRO_INFINITY';
  status: 'ATIVA' | 'REVOGADA';
  etiquetas_usadas: number;
  etiquetas_limite: number;
  max_condominios: number;
  suporte247: boolean;
  brandingPDF: boolean;
}

export type SubscriptionStatus = 'ACTIVE';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private db = inject(DbService);
  private router: Router = inject(Router);
  private ui = inject(UiService);
  private protection = inject(DataProtectionService);
  private hashService = inject(SimbioseHashService);
  // private injector = inject(Injector); // Removed: DeepSeek dependency removed

  currentUser = signal<Porteiro | null>(null);
  isDevMode = signal(false);
  
  // Flag para identificar se é o usuário padrão (000000)
  isGuestSession = computed(() => this.currentUser()?.id === 'guest_admin');
  
  subscriptionStatus = signal<SubscriptionStatus>('ACTIVE');
  activePlan = signal<string>('START'); // Default para START se não definido
  bonusLimit = signal(0);
  usageCount = computed(() => this.db.encomendas().length);
  
  adRewards = signal(0);
  
  // LIMITES DOS PLANOS
  private readonly LIMIT_FREE_BASE = 25;   // Plano Grátis/Start (Base)
  private readonly LIMIT_BASICO = 2500;    // Plano Básico (R$ 19,90)
  private readonly LIMIT_PRO = 45000;      // Plano Pro (R$ 49,90)
  private readonly LIMIT_ENTERPRISE = 250000;
  private readonly LIMIT_DEV = Infinity;
  
  // Verifica se tem plano (Agora inclui START/Guest, pois eles podem usar até o limite)
  hasActiveFeatureAccess = computed(() => {
      const p = this.activePlan();
      // MUDANÇA: Guest/START agora tem acesso às features (sujeito a limite de uso)
      return p === 'START' || p === 'BASICO' || p === 'PRO' || p === 'ENTERPRISE' || p === 'DEV_SUPREMO' || p === 'PRO_INFINITY';
  });
  
  // Limite dinâmico para o plano START (Free) baseado em anúncios assistidos
  currentFreeLimit = computed(() => {
      return this.LIMIT_FREE_BASE + (this.adRewards() * 5);
  });
  
  isLockedOut = signal(false);
  lockoutTimeRemaining = signal(0);
  shiftTimeRemaining = signal<string>('12:30:00');
  private shiftInterval: any = null;
  private warningTriggered = false;

  licenseToken = signal<string | null>(null);
  licenseDetails = signal<LicenseDetails | null>(null);
  isLicensed = computed(() => true); 
  
  private readonly LICENSE_KEY = 'simbiose_license_token';
  private readonly SESSION_KEY = 'protocolo_digital_session';
  private readonly ATTEMPTS_KEY = 'login_attempts_count';
  private readonly LOCKOUT_TIMESTAMP_KEY = 'login_lockout_until';
  private readonly AD_REWARDS_KEY = 'simbiose_ad_rewards';
  
  private readonly SESSION_DURATION = (12 * 60 * 60 * 1000) + (30 * 60 * 1000); 
  private readonly WARNING_THRESHOLD = 30 * 60 * 1000;
  private readonly MAX_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 30 * 1000;

  constructor() {
    if (!localStorage.getItem(this.LICENSE_KEY)) {
        localStorage.setItem(this.LICENSE_KEY, 'SIMBIOSE-QUANTUM-CORE');
    }
    
    const savedBonus = localStorage.getItem('simbiose_bonus_limit');
    if (savedBonus) {
        this.bonusLimit.set(parseInt(savedBonus, 10));
    }
    
    const savedRewards = localStorage.getItem(this.AD_REWARDS_KEY);
    if (savedRewards) {
        this.adRewards.set(parseInt(savedRewards, 10));
    }
    
    this.loadLicense();

    // localStorage.removeItem(this.SESSION_KEY); // Removed to allow session persistence

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            this.checkFingerprintEnforcement();
        }
    });
    
    effect(() => {
        if (this.db.initialized() && !this.currentUser()) {
            this.tryRestoreSession();
        }
        
        // Sincroniza plano com config global (Exceto Guest)
        if (this.db.initialized()) {
            const user = this.currentUser();
            const persistedConfig = this.db.appConfig();
            
            if (user?.id === 'guest_admin') {
                if (this.activePlan() !== 'START') this.activePlan.set('START');
            } else {
                // HERANÇA DE PLANO: Se houver um plano salvo na config global, use-o.
                if (persistedConfig.activePlan && persistedConfig.activePlan !== 'PENDENTE') {
                    if (this.activePlan() !== persistedConfig.activePlan) {
                        // console.log(`[AuthService] Herança de Plano Ativada: ${persistedConfig.activePlan}`);
                        this.activePlan.set(persistedConfig.activePlan);
                    }
                }
            }
        }
    }, { allowSignalWrites: true });
    
    this.checkLockout();
  }

  public getPlanLimit(): number {
      const plan = this.activePlan();
      let limit = 0;
      if (plan === 'START') limit = this.currentFreeLimit();
      else if (plan === 'BASICO') limit = this.LIMIT_BASICO;
      else if (plan === 'PRO') limit = this.LIMIT_PRO;
      else if (plan === 'ENTERPRISE') limit = this.LIMIT_ENTERPRISE;
      else if (plan === 'DEV_SUPREMO' || plan === 'PRO_INFINITY') limit = this.LIMIT_DEV;
      else limit = this.currentFreeLimit();
      
      return limit + this.bonusLimit();
  }

  public async reportUsage(amount: number = 1): Promise<{ ok: boolean; message?: string; code?: string }> {
      const current = this.usageCount();
      const limit = this.getPlanLimit();
      
      if (current + amount > limit) {
          const plan = this.activePlan();
          let msg = '';
          
          if (plan === 'START') {
              msg = 'Limite Grátis atingido.';
              return { ok: false, message: msg, code: 'LIMIT_REACHED_START' };
          } else if (plan === 'BASICO') {
              msg = 'Limite do plano Básico (2.500) atingido. Faça upgrade para PRO.';
          } else if (plan === 'PRO') {
              msg = 'Limite mensal do plano PRO (45.000) atingido. Adquira o pacote excedente para continuar.';
          } else {
              msg = 'Limite operacional atingido. Contate o suporte.';
          }
          
          return { ok: false, message: msg };
      }
      
      return { ok: true };
  }

  public watchAdReward() {
      const current = this.adRewards();
      const next = current + 1;
      this.adRewards.set(next);
      localStorage.setItem(this.AD_REWARDS_KEY, next.toString());
      this.ui.show('Recompensa Recebida! +5 etiquetas adicionadas.', 'SUCCESS');
  }

  private startShiftTimer(startTime: number) {
    if (this.shiftInterval) clearInterval(this.shiftInterval);
    this.warningTriggered = false;

    this.shiftInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startTime;
      const remaining = this.SESSION_DURATION - elapsed;

      if (remaining <= 0) {
        this.forceLogout('Turno Encerrado. Período de descanso obrigatório.');
        return;
      }

      if (remaining <= this.WARNING_THRESHOLD && !this.warningTriggered) {
        this.ui.show('Atenção: Turno encerrando em 30 minutos.', 'WARNING');
        this.ui.playTone('URGENT');
        this.warningTriggered = true;
      }

      const h = Math.floor(remaining / (1000 * 60 * 60));
      const m = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((remaining % (1000 * 60)) / 1000);
      
      this.shiftTimeRemaining.set(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);

    }, 1000);
  }

  // --- LOGIN & SESSION ---

  async login(pin: string): Promise<{ success: boolean; message?: string; user?: Porteiro }> {
    if (this.isLockedOut()) {
        const remaining = Math.ceil((parseInt(localStorage.getItem(this.LOCKOUT_TIMESTAMP_KEY) || '0') - Date.now()) / 1000);
        return { success: false, message: `Bloqueio de segurança. Aguarde ${remaining}s.` };
    }

    const hashedPin = await this.hashService.hashText(pin);
    const porteiros = this.db.porteiros();
    const user = porteiros.find(p => p.senha === hashedPin);
    
    // SENHA PADRÃO / GUEST ACCESS (000000)
    const defaultHash = await this.hashService.hashText('000000');
    
    if (hashedPin === defaultHash) {
        // --- REGRA DE OURO: BLOQUEIO EM AMBIENTE CONFIGURADO ---
        // Verifica se existem admins reais configurados (excluindo guest e devs do sistema)
        // Se houver, bloqueia o acesso padrão 000000.
        const hasConfiguredAdmins = porteiros.some(p => 
            p.isAdmin && 
            p.id !== 'guest_admin' && 
            p.id !== 'dev_master_quantum' && 
            p.id !== 'rodrigo_simbiose_vip' && 
            p.id !== 'luis_resolve_vip'
        );

        if (hasConfiguredAdmins) {
            return { 
                success: false, 
                message: 'Atenção, esse ambiente já possui administrador configurado.' 
            };
        }

        if (user) {
            this.resetAttempts();
            return { success: true, user };
        }
        
        // ACESSO GUEST PERMITIDO (Ambiente Virgem)
        const guestUser: Porteiro = {
            id: 'guest_admin',
            nome: 'USUÁRIO GRÁTIS',
            senha: '', 
            isAdmin: true, // Guest tem poderes locais
            isDev: false,
            condoId: 'GUEST_SESSION_ID' 
        };
        
        this.resetAttempts();
        return { success: true, user: guestUser };
    }

    if (user) {
        // IP Tracking for Admin (Backend)
        if (user.isAdmin) {
            try {
                const ip = await fetch('https://api.ipify.org').then(r => r.text());
                const response = await fetch('/api/check-ip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: user.id, ip })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.forceMultiCondo) {
                        localStorage.setItem(`force_multi_condo_${user.id}`, 'true');
                    } else {
                        localStorage.removeItem(`force_multi_condo_${user.id}`);
                    }
                } else {
                    console.error('Failed to track IP: Server returned', response.status);
                }
            } catch (e) {
                console.error('Failed to track IP:', e);
            }
        }

        this.resetAttempts();
        return { success: true, user };
    } else {
        this.recordFailedAttempt();
        return { success: false };
    }
  }

  async completeLogin(user: Porteiro, overridePlan?: string) {
      const tenantId = user.isDev ? null : (user.condoId || crypto.randomUUID());
      user.condoId = tenantId || undefined;
      
      this.db.currentTenantId.set(tenantId);
      await this.db.reloadSessionData();

      this.currentUser.set(user);
      this.isDevMode.set(!!user.isDev);
      
      const sessionData = {
          userId: user.id,
          startTime: Date.now(),
          signature: this.generateSessionSignature(user.id)
      };
      
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
      
      this.startShiftTimer(sessionData.startTime);
      
      this.db.logAction('LOGIN', `Acesso autorizado`, user.id, user.nome);
      this.ui.requestPushPermission();
      
      // --- LÓGICA DE HERANÇA DE PLANO ---
      let currentPlan = 'START';
      
      if (user.id === 'guest_admin') {
          currentPlan = 'START';
          // Clean Guest State
          localStorage.removeItem(`simbiose_guide_seen_${user.id}`);
          localStorage.removeItem('simbiose_pending_onboarding');
          localStorage.removeItem('simbiose_pending_plan');
          sessionStorage.removeItem('onboarding_just_completed');
      } else {
          // PARA USUÁRIOS REAIS: HERDA DA CONFIGURAÇÃO DO DB (Definida pelo Admin)
          const dbConfig = this.db.appConfig();
          if (dbConfig.activePlan && dbConfig.activePlan !== 'PENDENTE') {
              currentPlan = dbConfig.activePlan;
          } else {
              currentPlan = overridePlan || 'START';
          }
      }
      
      // VIP Logic Override
      if (user.id === 'luis_resolve_vip' || user.id === 'rodrigo_simbiose_vip') {
          currentPlan = 'PRO_INFINITY';
          const cfg = this.db.appConfig();
          this.db.saveAppConfig({ 
              ...cfg, 
              activePlan: currentPlan,
              nomeCondominio: user.id === 'luis_resolve_vip' ? 'Solve Prestadora' : 'Zelare Prestadora'
          });
      }
      
      // Persiste Plano na Configuração Global (Apenas Admin/Real)
      // Garante que o plano "cole" na instalação
      if (user.id !== 'guest_admin') { 
          const cfg = this.db.appConfig();
          // Se o plano atual for melhor que o salvo (ex: upgrade no login), atualiza
          if (currentPlan !== cfg.activePlan) {
              this.db.saveAppConfig({ ...cfg, activePlan: currentPlan });
          }
      }
      
      this.activePlan.set(currentPlan);

      // --- REDIRECIONAMENTO (INTERNAL LOGIC TO AVOID CIRCULAR DEP) ---
      let route = ['/dashboard'];
      let queryParams = {};

      if (user.isDev) {
          route = ['/admin'];
          queryParams = { tab: 'quantum' };
      } else if (!this.hasActiveFeatureAccess()) {
          route = ['/admin'];
          queryParams = { tab: 'quantum' };
      }

      this.router.navigate(route, { queryParams });
  }

  logout() {
      this.db.resetStateForLogout();
      this.isDevMode.set(false); 
      if (this.shiftInterval) clearInterval(this.shiftInterval);
      this.currentUser.set(null);
      localStorage.removeItem(this.SESSION_KEY);
      this.router.navigate(['/login']);
  }

  forceLogout(reason: string) {
      this.logout();
      this.ui.show(reason, 'ERROR');
  }

  private loadLicense() {
      const token = localStorage.getItem(this.LICENSE_KEY);
      if (token) this.licenseToken.set(token);
  }

  public async activateLicense(token: string): Promise<{ success: boolean; message: string }> {
      if (token.length > 8) {
          localStorage.setItem(this.LICENSE_KEY, token);
          this.licenseToken.set(token);
          this.db.logAction('CONFIG', `Licença ativada: ${token.substring(0,8)}...`);
          return { success: true, message: 'Licença Quantum ativada.' };
      }
      return { success: false, message: 'Token inválido.' };
  }

  private tryRestoreSession() {
      try {
          const raw = localStorage.getItem(this.SESSION_KEY);
          if (!raw) return;
          
          const session = JSON.parse(raw);
          const now = Date.now();
          
          if (now - session.startTime > this.SESSION_DURATION) {
              this.logout();
              return;
          }
          
          if (session.signature !== this.generateSessionSignature(session.userId)) {
              this.logout();
              return;
          }
          
          this.db.getItem<Porteiro>('porteiros', session.userId).then(user => {
              if (!user && session.userId === 'guest_admin') {
                  user = {
                      id: 'guest_admin',
                      nome: 'USUÁRIO GRÁTIS',
                      senha: '',
                      isAdmin: true,
                      isDev: false,
                      condoId: 'GUEST_SESSION_ID' 
                  };
              }
              
              if (user) {
                  if (user.id === 'luis_resolve_vip' || user.id === 'rodrigo_simbiose_vip') {
                      this.activePlan.set('PRO_INFINITY');
                      user.isDev = false; 
                  }

                  const tenantId = user.isDev ? null : (user.condoId || crypto.randomUUID());
                  this.db.currentTenantId.set(tenantId);
                  
                  this.db.reloadSessionData().then(() => {
                      this.currentUser.set(user);
                      this.isDevMode.set(!!user.isDev);
                      this.startShiftTimer(session.startTime);
                      
                      // RESTORE PLAN FROM CONFIG (HERANÇA)
                      if (user.id === 'guest_admin') {
                          this.activePlan.set('START'); 
                      } else {
                          const dbPlan = this.db.appConfig().activePlan;
                          this.activePlan.set(dbPlan && dbPlan !== 'PENDENTE' ? dbPlan : 'START');
                      }

                      if ('Notification' in window && Notification.permission === 'default') {
                          this.ui.requestPushPermission();
                      }

                      if (this.router.url === '/' || this.router.url === '/login') {
                          // RE-APPLY REDIRECT LOGIC
                          let route = ['/dashboard'];
                          let queryParams = {};

                          if (user.isDev) {
                              route = ['/admin'];
                              queryParams = { tab: 'quantum' };
                          } else if (!this.hasActiveFeatureAccess()) {
                              route = ['/admin'];
                              queryParams = { tab: 'quantum' };
                          }
                          this.router.navigate(route, { queryParams });
                      }
                  });
              } else {
                  this.logout();
              }
          });

      } catch (e) {
          this.logout();
      }
  }

  private generateSessionSignature(userId: string): string {
      return btoa(`simbiose_secure_${userId}_${navigator.userAgent}`);
  }

  private recordFailedAttempt() {
      let attempts = parseInt(localStorage.getItem(this.ATTEMPTS_KEY) || '0') + 1;
      localStorage.setItem(this.ATTEMPTS_KEY, attempts.toString());
      
      if (attempts >= this.MAX_ATTEMPTS) {
          const lockoutUntil = Date.now() + this.LOCKOUT_DURATION;
          localStorage.setItem(this.LOCKOUT_TIMESTAMP_KEY, lockoutUntil.toString());
          this.checkLockout();
      }
  }

  private resetAttempts() {
      localStorage.removeItem(this.ATTEMPTS_KEY);
      localStorage.removeItem(this.LOCKOUT_TIMESTAMP_KEY);
      this.isLockedOut.set(false);
  }

  private checkLockout() {
      const lockoutUntil = parseInt(localStorage.getItem(this.LOCKOUT_TIMESTAMP_KEY) || '0');
      if (lockoutUntil > Date.now()) {
          this.isLockedOut.set(true);
          this.lockoutTimeRemaining.set(Math.ceil((lockoutUntil - Date.now()) / 1000));
          
          const interval = setInterval(() => {
              const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
              this.lockoutTimeRemaining.set(remaining);
              if (remaining <= 0) {
                  this.isLockedOut.set(false);
                  clearInterval(interval);
                  localStorage.removeItem(this.LOCKOUT_TIMESTAMP_KEY);
                  localStorage.removeItem(this.ATTEMPTS_KEY);
              }
          }, 1000);
      }
  }

  async registerFingerprint(): Promise<boolean> {
      const user = this.currentUser();
      if (!user || (!user.isAdmin && !user.isDev)) {
          this.ui.show('Acesso negado: Apenas Admins/Devs podem usar biometria.', 'WARNING');
          return false;
      }

      try {
          const challenge = new Uint8Array(32);
          window.crypto.getRandomValues(challenge);
          
          const publicKeyCredentialCreationOptions = {
              challenge: challenge,
              rp: { name: "Simbiose Protocolo", id: window.location.hostname },
              user: {
                  id: new TextEncoder().encode(user.id),
                  name: user.nome,
                  displayName: user.nome,
              },
              pubKeyCredParams: [{ alg: -7, type: "public-key" }],
              authenticatorSelection: { authenticatorAttachment: "platform" },
              timeout: 60000,
              attestation: "direct"
          };

          const credential = await navigator.credentials.create({
              publicKey: publicKeyCredentialCreationOptions
          } as any);

          await this.db.saveItem('user_credentials', {
              id: user.id,
              credential: credential
          });

          if (user.isAdmin) {
              this.db.updateAppConfig({ adminFingerprintRegistered: true });
          }
          
          // Mark user as having fingerprint registered
          user.hasFingerprint = true;
          this.db.saveItem('porteiros', user);

          this.ui.show('Digital cadastrada com sucesso!', 'SUCCESS');
          return true;
      } catch (e: any) {
          console.error('Fingerprint registration failed:', e);
          if (e.name === 'NotAllowedError' || e.message?.includes('publickey-credentials-create')) {
              this.ui.show('Biometria indisponível nesta pré-visualização. Funcionará no ambiente de produção.', 'WARNING');
          } else {
              this.ui.show('Falha ao cadastrar digital.', 'ERROR');
          }
          return false;
      }
  }

  async loginWithFingerprint(): Promise<{ success: boolean, user?: any, message?: string }> {
      try {
          const publicKeyCredentialRequestOptions = {
              challenge: new Uint8Array(32),
              allowCredentials: [],
              timeout: 60000,
              userVerification: "required"
          };

          const assertion = await navigator.credentials.get({
              publicKey: publicKeyCredentialRequestOptions
          } as any);

          // In a real app, verify the assertion with the server
          // For now, we simulate success if assertion exists
          if (assertion) {
              // Fetch user from DB based on credential ID
              // This is simplified
              const users = this.db.porteiros();
              const user = users[0]; // Simplified
              this.ui.show('Login com digital realizado!', 'SUCCESS');
              return { success: true, user };
          }
          return { success: false, message: 'Falha no login com digital.' };
      } catch (e) {
          console.error('Fingerprint login failed:', e);
          this.ui.show('Falha no login com digital.', 'ERROR');
          return { success: false, message: 'Falha no login com digital.' };
      }
  }

  private async checkFingerprintEnforcement() {
      const user = this.currentUser();
      if (user && user.hasFingerprint) {
          const result = await this.loginWithFingerprint();
          if (!result.success) {
              this.ui.show('Autenticação biométrica necessária.', 'WARNING');
          }
      }
  }
}
