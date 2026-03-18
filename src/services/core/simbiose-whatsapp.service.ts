
import { Injectable } from '@angular/core';

export type TipoPessoa = 'MORADOR' | 'OPERARIO' | 'MOTOQUEIRO';

@Injectable({ providedIn: 'root' })
export class SimbioseWhatsappService {

  enviar(
    pessoa: {
      nome: string;
      tipo: TipoPessoa;
      telefone: string;
    },
    protocolo: {
      id: string;
      tipo: string;
      bloco?: string;
      unidade?: string;
      condicao?: string;
      status?: string;
      link?: string;
    },
    mensagemOverride?: string
  ) {

    let mensagem = '';

    if (mensagemOverride) {
      mensagem = mensagemOverride;
    } else {
      // Templates de Fallback (Caso a IA não gere)
      const primeiroNome = pessoa.nome.split(' ')[0];
      
      if (pessoa.tipo === 'MORADOR') {
        mensagem =
          `📦 *CHEGOU!*\n\n` +
          `Olá ${primeiroNome}, uma nova *${protocolo.tipo}* chegou para você.\n\n` +
          `📍 *Local:* Bloco ${protocolo.bloco} - Apto ${protocolo.unidade}\n` +
          `📦 *Estado:* ${protocolo.condicao || 'Intacta'}\n` +
          `🔖 *Cód:* ${protocolo.id.substring(0, 6).toUpperCase()}`;
      } else if (pessoa.tipo === 'OPERARIO') {
        mensagem =
          `🔧 *PROTOCOLO INTERNO*\n` +
          `Destino: ${pessoa.nome}\n` +
          `Status: ${protocolo.status}`;
      } else if (pessoa.tipo === 'MOTOQUEIRO') {
        mensagem =
          `🛵 *RETIRADA AUTORIZADA*\n` +
          `Protocolo: ${protocolo.id}`;
      } else {
        mensagem = `📋 *Protocolo Simbiose:* ${protocolo.id}`;
      }
      
      // Adiciona o rodapé padrão apenas se NÃO for mensagem override
      mensagem += `\n\n_Mensagem automática do Sistema Simbiose_`;
    }

    // Apenas anexa o link se ele for público (não um blob local)
    if (protocolo.link && !protocolo.link.startsWith('blob:')) {
      mensagem += `\n\n📄 *Comprovante Digital:* ${protocolo.link}`;
    }
    
    // Higienização Robusta de Telefone
    let phone = pessoa.telefone.replace(/\D/g, ''); // Remove tudo que não é dígito
    
    // Lógica para DDI Brasil (55)
    // Se tem 10 ou 11 dígitos (DDD + Número), adiciona 55
    if (phone.length >= 10 && phone.length <= 11) {
        phone = '55' + phone;
    } 
    // Se não começa com 55 e parece ser um número válido, adiciona por segurança
    else if (phone.length > 8 && !phone.startsWith('55')) {
        phone = '55' + phone;
    }

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(mensagem)}`;
    window.open(url, '_blank');
  }
}
