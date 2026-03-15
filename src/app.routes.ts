
import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { ScannerComponent } from './components/scanner/scanner.component';
import { PackageFormComponent } from './components/package-form/package-form.component';
import { AdminHubComponent } from './components/admin/admin.component';
import { ManualComponent } from './components/manual/manual.component';
import { NovoProtocoloComponent } from './components/novo-protocolo/novo-protocolo.component';
import { SecureDownloadComponent } from './components/secure-download/secure-download.component';
import { ExampleComponent } from './app/components/example/example.component';
import { inject } from '@angular/core';
import { AuthService } from './services/auth.service';
import { Router } from '@angular/router';
import { UiService } from './services/ui.service';

const multiCondoGuard = () => {
    const auth = inject(AuthService);
    const router: Router = inject(Router);
    const ui = inject(UiService);
    const user = auth.currentUser();

    if (user && user.isAdmin && localStorage.getItem(`force_multi_condo_${user.id}`)) {
        ui.show('Acesso restrito: Multi-condomínio obrigatório para este IP.', 'WARNING');
        return router.createUrlTree(['/admin'], { queryParams: { tab: 'multi-condo' } });
    }
    return true;
};

const authGuard = () => {
    const auth = inject(AuthService);
    const router: Router = inject(Router);
    if (auth.currentUser()) {
        return true;
    }
    return router.parseUrl('/login');
};

const planGuard = () => {
    const auth = inject(AuthService);
    const router: Router = inject(Router);
    const ui = inject(UiService);

    if (auth.hasActiveFeatureAccess()) {
        return true;
    }
    
    ui.show('Funcionalidade bloqueada. Ative um plano.', 'WARNING');
    return router.createUrlTree(['/admin'], { queryParams: { tab: 'quantum' } });
};

const guestBlockGuard = () => {
    return true;
};

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { 
    path: 'dashboard', 
    component: DashboardComponent,
    canActivate: [authGuard, guestBlockGuard, multiCondoGuard] 
  },
  { 
    path: 'scanner', 
    component: ScannerComponent, 
    canActivate: [authGuard, planGuard, multiCondoGuard] 
  },
  { 
    path: 'package/new', 
    component: PackageFormComponent, 
    canActivate: [authGuard, planGuard, multiCondoGuard] 
  },
  { 
    path: 'correspondence/new', 
    component: PackageFormComponent, 
    canActivate: [authGuard, planGuard, multiCondoGuard] 
  },
  { 
    path: 'package/:id', 
    component: PackageFormComponent,
    canActivate: [authGuard, multiCondoGuard]
  },
  { 
    path: 'admin', 
    component: AdminHubComponent, 
    canActivate: [authGuard] 
  },
  {
    path: 'manual',
    component: ManualComponent,
    canActivate: [authGuard, guestBlockGuard]
  },
  {
    path: 'novo-protocolo',
    component: NovoProtocoloComponent,
    canActivate: [authGuard, multiCondoGuard]
  },
  {
    path: 'secure-download/:id',
    component: SecureDownloadComponent
  },
  {
    path: 'example',
    component: ExampleComponent
  }
];
