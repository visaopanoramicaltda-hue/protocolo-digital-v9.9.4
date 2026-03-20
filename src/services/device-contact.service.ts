
import { Injectable, signal, inject } from '@angular/core';
import { UiService } from './ui.service';

export interface DeviceContact {
  name: string;
  tel: string;
}

@Injectable({
  providedIn: 'root'
})
export class DeviceContactService {
  private ui = inject(UiService);
  
  isSupported = signal(false);

  constructor() {
    this.checkSupport();
  }

  private checkSupport() {
    // Verifica suporte à API de Contatos Nativa (Chrome Android / iOS moderno)
    // A API só funciona em Top Frame (não iframes)
    const isTopFrame = window.self === window.top;
    const supported = 'contacts' in navigator && 'ContactsManager' in window && isTopFrame;
    this.isSupported.set(!!supported);
  }

  /**
   * Abre o seletor nativo de contatos do celular (Agenda/Gmail).
   * Requer interação do usuário (clique).
   */
  async pickContact(): Promise<DeviceContact | null> {
    // 1. Verificação de Suporte (Sem dados fictícios)
    if (!this.isSupported()) {
        this.ui.show('Agenda indisponível neste dispositivo (Use Android/iOS).', 'WARNING');
        return null;
    }

    try {
      const props = ['name', 'tel'];
      const opts = { multiple: false };
      
      // @ts-expect-error - TypeScript pode não ter a definição da API experimental ainda
      const contacts = await navigator.contacts.select(props, opts);

      if (contacts && contacts.length > 0) {
        const contact = contacts[0];
        const name = contact.name ? contact.name[0] : '';
        let tel = contact.tel ? contact.tel[0] : '';
        
        // Limpeza básica do telefone
        tel = tel.replace(/\D/g, ''); 
        
        // Formata para 55 + DDD + Número
        if (tel.startsWith('0')) {
            tel = tel.substring(1);
        }
        if (tel.length === 10 || tel.length === 11) {
            tel = '55' + tel;
        }
        
        return { name, tel };
      }
    } catch (e: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err = e as any;
      if (err.name === 'SecurityError' || (err.message && err.message.includes('top frame'))) {
          this.ui.show('Erro de permissão: Abra o app fora do frame.', 'ERROR');
      } else {
          console.error('[ContactService] Erro ou cancelamento:', err);
      }
    }
    return null;
  }

  /**
   * Simula a busca em "segundo plano" requisitada pela inteligência do sistema.
   * Nota técnica: Browsers bloqueiam acesso silencioso à agenda por privacidade.
   * Esta função tenta buscar em caches locais previamente importados ou retorna
   * um sinal para que a UI solicite a permissão ao usuário.
   */
  async backgroundSearch(name: string): Promise<string | null> {
      // 1. Tenta buscar em cache local de contatos frequentes (se houver implementação futura de sync)
      const cachedContacts = localStorage.getItem('simbiose_cached_contacts');
      if (cachedContacts) {
          try {
              const list: DeviceContact[] = JSON.parse(cachedContacts);
              const match = list.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
              if (match) return match.tel;
          } catch {}
      }
      
      // Como fallback, retorna null, o que acionará o fluxo de "Sugestão de Vínculo" na UI
      return null;
  }
}
