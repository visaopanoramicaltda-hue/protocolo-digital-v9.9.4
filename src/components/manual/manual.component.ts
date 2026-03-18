
import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';

type ManualTab = 'PORTEIRO' | 'ADMIN' | 'FAQ';

@Component({
  selector: 'app-manual',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="h-[100dvh] bg-[#050505] text-[#2a2320] font-serif flex flex-col relative overflow-hidden">
      <!-- Background Textures -->
      <div class="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')] opacity-30 pointer-events-none z-0"></div>
      
      <!-- Header -->
      <header class="relative z-10 bg-gradient-to-b from-[#1a1a1a] to-black border-b border-white/5 px-6 py-4 flex justify-between items-center shadow-2xl shrink-0 safe-area-pt safe-area-pr safe-area-pl">
        <div class="flex items-center gap-4">
           <a routerLink="/dashboard" class="text-gray-400 hover:text-white transition-colors uppercase font-medium text-[9px] tracking-widest flex items-center gap-2">
             <span class="text-lg">←</span> Voltar ao Painel
           </a>
        </div>
        <h1 class="text-white font-light uppercase tracking-[0.2em] text-sm hidden md:block">
          Protocolo Inteligente {{ ui.APP_VERSION }}
        </h1>
      </header>

      <!-- Main Content (Paper Style) -->
      <div class="flex-1 overflow-y-scroll p-4 md:p-8 relative z-10 custom-scrollbar safe-area-pb safe-area-pr safe-area-pl">
        <div class="max-w-6xl mx-auto bg-[#FDFBF7] shadow-[0_0_50px_rgba(0,0,0,0.5)] border-t border-[#d1c4b5] relative flex flex-col rounded-sm">
           <!-- Paper Texture -->
           <div class="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cream-paper.png')] opacity-50 pointer-events-none mix-blend-multiply rounded-sm"></div>
           
           <!-- Internal Header -->
           <div class="relative z-10 p-8 border-b-2 border-[#2a2320] bg-[#EAE0D5] rounded-t-sm">
             <h2 class="text-2xl font-black text-[#2a2320] uppercase mb-2">Guia Visual de Acesso</h2>
              <p class="text-xs font-bold text-[#5c4d46] uppercase tracking-widest">Protocolo Inteligente Simbiose</p>
              
              <!-- Tabs -->
              <div class="flex mt-8 gap-1 overflow-x-auto pb-2 md:pb-0">
                  <button (click)="activeTab.set('PORTEIRO')" 
                          class="px-6 py-3 font-black uppercase text-xs tracking-widest border-t-2 border-x-2 border-[#2a2320] transition-all relative top-[2px] whitespace-nowrap"
                          [class.bg-[#FDFBF7]]="activeTab() === 'PORTEIRO'"
                          [class.text-[#E86C26]]="activeTab() === 'PORTEIRO'"
                          [class.bg-[#dcd3cb]]="activeTab() !== 'PORTEIRO'">
                      Portaria (Operacional)
                  </button>
                  @if (auth.currentUser()?.isAdmin) {
                    <button (click)="activeTab.set('ADMIN')" 
                            class="px-4 py-2 font-black uppercase text-[9px] tracking-widest border-t-2 border-x-2 border-[#2a2320] transition-all relative top-[2px] whitespace-nowrap"
                            [class.bg-[#FDFBF7]]="activeTab() === 'ADMIN'"
                            [class.text-[#E86C26]]="activeTab() === 'ADMIN'"
                            [class.bg-[#dcd3cb]]="activeTab() !== 'ADMIN'">
                        Gestor (Síndico)
                    </button>
                    <button (click)="activeTab.set('FAQ')" 
                            class="px-4 py-2 font-black uppercase text-[9px] tracking-widest border-t-2 border-x-2 border-[#2a2320] transition-all relative top-[2px] whitespace-nowrap"
                            [class.bg-[#FDFBF7]]="activeTab() === 'FAQ'"
                            [class.text-[#E86C26]]="activeTab() === 'FAQ'"
                            [class.bg-[#dcd3cb]]="activeTab() !== 'FAQ'">
                        Dicas
                    </button>
                  }
              </div>
           </div>

           <!-- Content Body -->
           <div class="relative z-10 p-6 md:p-10 text-[#2a2320] leading-relaxed">
              
              <!-- ================= PORTEIRO (VISUAL CARDS) ================= -->
              @if (activeTab() === 'PORTEIRO') {
                <div class="animate-[fadeIn_0.3s]">
                  <h3 class="text-lg font-black uppercase mb-8 border-b-2 border-[#E86C26] inline-block pr-4">Fluxo de Chegada (Scanner IA)</h3>
                  
                  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
                      <!-- CARD 1 -->
                      <div class="bg-white border-2 border-[#2a2320] p-6 rounded-sm shadow-[5px_5px_0px_rgba(42,35,32,0.1)] hover:shadow-[5px_5px_0px_#E86C26] transition-shadow group h-full flex flex-col">
                          <div class="w-12 h-12 bg-[#2a2320] text-white flex items-center justify-center font-black text-xl rounded-full mb-4 group-hover:bg-[#E86C26] transition-colors">1</div>
                          <h4 class="font-black uppercase text-sm mb-2">Iniciar Scanner</h4>
                          <p class="text-[10px] text-[#5c4d46] flex-1">Clique no botão grande <strong>"NOVA ENCOMENDA"</strong> no painel inicial. Aponte a câmera para a etiqueta de envio.</p>
                          <div class="mt-4 p-2 bg-[#F2EBE5] border border-[#d1c4b5] text-[10px] font-bold uppercase text-[#E86C26]">Dica: Não tape a etiqueta</div>
                      </div>

                      <!-- CARD 2 -->
                      <div class="bg-white border-2 border-[#2a2320] p-6 rounded-sm shadow-[5px_5px_0px_rgba(42,35,32,0.1)] hover:shadow-[5px_5px_0px_#E86C26] transition-shadow group h-full flex flex-col">
                          <div class="w-12 h-12 bg-[#2a2320] text-white flex items-center justify-center font-black text-xl rounded-full mb-4 group-hover:bg-[#E86C26] transition-colors">2</div>
                          <h4 class="font-black uppercase text-sm mb-2">Conferência Visual</h4>
                          <p class="text-[10px] text-[#5c4d46] flex-1">A IA vai ler o nome e o rastreio. Confira se os dados batem. Se a unidade estiver errada, toque no nome para corrigir.</p>
                          <div class="mt-4 p-2 bg-[#F2EBE5] border border-[#d1c4b5] text-[10px] font-bold uppercase text-[#E86C26]">Dica: O sistema aprende correções</div>
                      </div>

                      <!-- CARD 3 -->
                      <div class="bg-white border-2 border-[#2a2320] p-6 rounded-sm shadow-[5px_5px_0px_rgba(42,35,32,0.1)] hover:shadow-[5px_5px_0px_#E86C26] transition-shadow group h-full flex flex-col">
                          <div class="w-12 h-12 bg-[#2a2320] text-white flex items-center justify-center font-black text-xl rounded-full mb-4 group-hover:bg-[#E86C26] transition-colors">3</div>
                          <h4 class="font-black uppercase text-sm mb-2">Carimbar & Enviar</h4>
                          <p class="text-[10px] text-[#5c4d46] flex-1">Selecione o estado (Intacta/Violada) e clique em <strong>CARIMBAR</strong>. Um botão de WhatsApp aparecerá para enviar o comprovante ao morador.</p>
                      </div>
                  </div>

                  <h3 class="text-xl font-black uppercase mb-8 border-b-2 border-[#E86C26] inline-block pr-4">Fluxo de Entrega (Retirada)</h3>
                  
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <!-- CARD RETIRADA 1 -->
                      <div class="bg-[#2a120a] p-6 rounded-sm shadow-lg text-[#EAE0D5] relative overflow-hidden group">
                          <div class="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/leather.png')] opacity-30 mix-blend-overlay"></div>
                          <div class="relative z-10 flex gap-4">
                              <div class="text-4xl">🔍</div>
                              <div>
                                  <h4 class="font-black uppercase text-lg mb-2 text-[#E86C26]">1. Localizar</h4>
                                  <p class="text-sm opacity-90">Use a barra de busca no topo. Digite o <strong>APTO</strong> (ex: "101") ou o <strong>NOME</strong> do morador. Clique no cartão da encomenda.</p>
                              </div>
                          </div>
                      </div>

                      <!-- CARD RETIRADA 2 -->
                      <div class="bg-[#2a120a] p-6 rounded-sm shadow-lg text-[#EAE0D5] relative overflow-hidden group">
                          <div class="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/leather.png')] opacity-30 mix-blend-overlay"></div>
                          <div class="relative z-10 flex gap-4">
                              <div class="text-4xl">✍️</div>
                              <div>
                                  <h4 class="font-black uppercase text-lg mb-2 text-[#E86C26]">2. Assinar Digitalmente</h4>
                                  <p class="text-sm opacity-90">Clique em "ASSINAR". Se for o morador, selecione o nome. Se for terceiro, digite o <strong>CPF (Obrigatório)</strong> e colete a assinatura na tela.</p>
                              </div>
                          </div>
                      </div>
                  </div>
                </div>
              }

              <!-- ================= ADMIN ================= -->
              @if (activeTab() === 'ADMIN') {
                <div class="space-y-12 animate-[fadeIn_0.3s]">
                    
                    <section>
                        <h3 class="text-xl font-black uppercase mb-6 border-b-2 border-[#E86C26] inline-block pr-4">Gestão de Moradores</h3>
                        
                        <div class="bg-white border-l-8 border-[#E86C26] p-6 shadow-sm">
                            <h4 class="text-lg font-bold uppercase text-[#2a2320] mb-4">Cadastro é Fundamental</h4>
                            <p class="text-sm mb-4">Para que a IA funcione e as notificações de WhatsApp sejam automáticas, mantenha a lista de moradores atualizada.</p>
                            
                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div class="bg-[#F2EBE5] p-3 border border-[#d1c4b5]">
                                    <strong class="block text-[10px] uppercase text-[#E86C26] mb-1">Passo 1</strong>
                                    <span class="text-xs font-bold">Vá em ADMIN > Moradores</span>
                                </div>
                                <div class="bg-[#F2EBE5] p-3 border border-[#d1c4b5]">
                                    <strong class="block text-[10px] uppercase text-[#E86C26] mb-1">Passo 2</strong>
                                    <span class="text-xs font-bold">Clique em + NOVO</span>
                                </div>
                                <div class="bg-[#F2EBE5] p-3 border border-[#d1c4b5]">
                                    <strong class="block text-[10px] uppercase text-[#E86C26] mb-1">Dica</strong>
                                    <span class="text-xs font-bold">Use o formato 11999999999 no telefone.</span>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h3 class="text-xl font-black uppercase mb-6 border-b-2 border-[#E86C26] inline-block pr-4">Segurança de Dados</h3>
                        
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div class="border-2 border-[#2a2320] p-5 bg-white relative overflow-hidden">
                                <div class="absolute top-0 right-0 bg-[#2a2320] text-white text-[9px] px-2 py-1 font-bold uppercase">Automático</div>
                                <h5 class="font-black text-sm mb-2 uppercase">Backup Nuvem</h5>
                                <p class="text-xs opacity-80">O sistema sincroniza dados criptografados a cada ação. Não se preocupe com salvamento manual no dia a dia.</p>
                            </div>
                            
                            <div class="border-2 border-[#E86C26] p-5 bg-[#fff8f5] relative overflow-hidden">
                                <div class="absolute top-0 right-0 bg-[#E86C26] text-white text-[9px] px-2 py-1 font-bold uppercase">Recomendado</div>
                                <h5 class="font-black text-sm mb-2 uppercase">Cofre Local</h5>
                                <p class="text-xs opacity-80">Ative em ADMIN > Backup. Isso cria uma cópia espelho no disco rígido do computador da portaria.</p>
                            </div>
                        </div>
                    </section>
                </div>
              }

              <!-- ================= FAQ / DICAS ================= -->
              @if (activeTab() === 'FAQ') {
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 animate-[fadeIn_0.3s]">
                    
                    <div class="bg-white border-2 border-[#d1c4b5] p-6 shadow-[4px_4px_0_#d1c4b5] relative">
                        <span class="text-2xl absolute top-4 right-4">💡</span>
                        <h4 class="font-black text-[#2a2320] uppercase mb-2 text-sm pr-8">Etiqueta Rasgada?</h4>
                        <p class="text-xs text-[#5c4d46] leading-relaxed">Se a câmera não conseguir ler, a tela de "Sem Leitura" aparecerá. Clique em <strong>MANUAL</strong> e digite apenas o APTO ou NOME. O sistema completará o resto.</p>
                    </div>

                    <div class="bg-white border-2 border-[#d1c4b5] p-6 shadow-[4px_4px_0_#d1c4b5] relative">
                        <span class="text-2xl absolute top-4 right-4">📄</span>
                        <h4 class="font-black text-[#2a2320] uppercase mb-2 text-sm pr-8">2ª Via de Comprovante</h4>
                        <p class="text-xs text-[#5c4d46] leading-relaxed">Precisa reenviar o comprovante? Vá em <strong>Dashboard > Filtro ENTREGUE</strong>. Encontre a caixa e clique no botão verde "2ª VIA PDF".</p>
                    </div>

                    <div class="bg-white border-2 border-[#d1c4b5] p-6 shadow-[4px_4px_0_#d1c4b5] relative">
                        <span class="text-2xl absolute top-4 right-4">📱</span>
                        <h4 class="font-black text-[#2a2320] uppercase mb-2 text-sm pr-8">WhatsApp Bloqueado</h4>
                        <p class="text-xs text-[#5c4d46] leading-relaxed">Se o WhatsApp não abrir, verifique a barra de endereço do navegador. Um ícone de "Pop-up Bloqueado" pode aparecer. Permita pop-ups para o Simbiose.</p>
                    </div>

                    <div class="bg-white border-2 border-[#d1c4b5] p-6 shadow-[4px_4px_0_#d1c4b5] relative">
                        <span class="text-2xl absolute top-4 right-4">🔑</span>
                        <h4 class="font-black text-[#2a2320] uppercase mb-2 text-sm pr-8">Perdi a Senha</h4>
                        <p class="text-xs text-[#5c4d46] leading-relaxed">Apenas o Administrador Mestre pode resetar senhas. Peça ao Síndico ou Gerente para acessar o painel ADMIN > Porteiros e redefinir seu acesso.</p>
                    </div>

                </div>
              }

           </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .custom-scrollbar { 
        scrollbar-gutter: stable;
        scrollbar-width: thin;
        scrollbar-color: #2a2320 #e5e5e5;
    }
    .custom-scrollbar::-webkit-scrollbar { width: 10px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #e5e5e5; border-radius: 4px; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #2a2320; border-radius: 4px; border: 2px solid #e5e5e5; }
  `]
})
export class ManualComponent {
  auth = inject(AuthService);
  ui = inject(UiService);
  activeTab = signal<ManualTab>('PORTEIRO');

  constructor() {
    if (this.auth.currentUser()?.isAdmin) {
      this.activeTab.set('ADMIN');
    }
  }
}
