
import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SingleSessionService {
  
  // Sinaliza se esta aba deve ser bloqueada (Sempre falso agora - Múltiplas abas permitidas)
  isSessionBlocked = signal(false);
  
  constructor() {
      // Monitoramento de sessão única desativado.
      // O sistema agora permite múltiplas abas/janelas simultâneas.
  }

  /**
   * Método mantido para compatibilidade com chamadas existentes, mas sem efeito de bloqueio.
   */
  public takeOverSession() {
    this.isSessionBlocked.set(false);
  }
}
