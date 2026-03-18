
import { Component, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { ScannerDataService } from '../../services/scanner-data.service';
import { DbService, Encomenda, Morador } from '../../services/db.service';
import { AuthService } from '../../services/auth.service';
import { UiService } from '../../services/ui.service';
import { PdfService } from '../../services/pdf.service';

interface Shelf { title: string; items: Encomenda[]; }
interface GroupedItem { id: string; destinatarioNome: string; bloco?: string; apto?: string; groupCount: number; groupItems: Encomenda[]; status: string; dataEntrada: string; fotoBase64?: string; transportadora?: string; codigoRastreio?: string; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePipe, MatIconModule],
  templateUrl: './dashboard.component.html',
  styles: [` :host { display: block; height: 100%; width: 100%; } `]
})
export class DashboardComponent implements OnDestroy {
  db = inject(DbService);
  auth = inject(AuthService);
  ui = inject(UiService);
  router = inject(Router);
  pdf = inject(PdfService);
  private scannerDataService = inject(ScannerDataService);

  // --- STATE SIGNALS ---
  searchQuery = signal('');
  activeFilter = signal<string>('PENDENTE'); // Default Absoluto
  displayLimit = signal<number>(50);
  viewMode = signal<'LIST' | 'SHELF'>('LIST');
  
  // Modal States
  showSearchModal = signal(false);
  showUpdateCard = signal(false);
  showGuide = signal(false);
  
  // Selection States
  selectedShelf = signal<Shelf | null>(null);
  selectedGroup = signal<GroupedItem | null>(null); // Para o modal de agrupamento
  selectedSearchItem = signal<Encomenda | null>(null); // Para detalhe vindo da busca (se clicar no item específico)
  
  // Withdrawal Flow State
  withdrawalItem = signal<Encomenda | GroupedItem | null>(null); // Item sendo retirado (pode ser um grupo disfarçado ou single)
  withdrawalStep = signal<'NAME' | 'SIGNATURE' | 'SUCCESS'>('NAME');
  withdrawalReceiverName = signal('');
  withdrawalReceiverCpf = signal(''); // Novo: CPF para terceiros
  withdrawalSignature = signal<string | null>(null);
  
  // Controls visibility of suggestions explicitly
  suggestionsActive = signal(false); 
  // Armazena os moradores da unidade atual para sugestão imediata
  unitResidentsSuggestions = signal<Morador[]>([]);
  
  isGeneratingProof = signal(false);
  hasSharedProof = signal(false); // Controle para liberar botão de fechar
  
  // Quick Register / Third Party Logic
  showQuickRegisterModal = signal(false);
  quickRegName = signal('');
  isThirdPartyMode = signal(false); // Se true, pede CPF e não salva morador no banco

  // Group Action Logic (Retirar Todos vs Individual)
  showGroupActionModal = signal(false);
  groupActionItem = signal<Encomenda | GroupedItem | null>(null); // O item "pai" que representa o grupo no card

  // Search Logic Helpers
  searchExpandedCategory = signal<'PENDENTE' | 'ENTREGUE' | null>(null);
  
  // Local signal for image viewer compatibility
  viewingImage = signal<string | null>(null);

  // Constants
  readonly CURRENT_APP_VERSION = this.ui.APP_VERSION;
  readonly filters = ['PENDENTE', 'ENTREGUE', 'CANCELADA'];
  
  readonly UPDATE_FEATURES = [
      { icon: '🚀', title: 'Performance Extrema', desc: 'Carregamento instantâneo e animações fluidas em 60fps.' },
      { icon: '📦', title: 'Agrupamento Inteligente', desc: 'Várias encomendas para o mesmo morador agora aparecem como um único card (+Volumes).' },
      { icon: '🧠', title: 'Busca Neural', desc: 'Encontre moradores e pacotes instantaneamente com a nova busca global.' },
      { icon: '🔒', title: 'Segurança Total', desc: 'Criptografia de ponta a ponta e conformidade total com LGPD.' }
  ];

  constructor() {
      const lastVersion = localStorage.getItem('simbiose_version_ack');
      if (lastVersion !== this.CURRENT_APP_VERSION) { this.showUpdateCard.set(true); }
      effect(() => {
          const isViewingGroup = !!this.selectedGroup();
          if (isViewingGroup) { setTimeout(() => this.ui.isImageViewerOpen.set(true)); } else if (!this.ui.currentFullscreenImage()) { setTimeout(() => this.ui.isImageViewerOpen.set(false)); }
      }, { allowSignalWrites: true });
      effect(() => { setTimeout(() => this.ui.isSignatureMode.set(!!this.withdrawalItem())); }, { allowSignalWrites: true });
      effect(() => {
          const flow = this.db.tempFlowState();
          if (flow && flow.active && flow.type === 'WITHDRAWAL_REGISTER' && flow.data.returnToDashboard) {
              const pkg = this.encomendas().find(e => e.id === flow.data.packageId);
              if (pkg) { 
                  // Lógica de retorno: Reabre o modal de retirada e preenche o nome (que foi atualizado pelo Admin após salvar)
                  setTimeout(() => { 
                      this.startWithdrawal(pkg); 
                      // Se retornou do cadastro, aí sim preenchemos o nome que acabou de ser criado
                      this.withdrawalReceiverName.set(flow.data.tempName); 
                      // Automaticamente avança para assinatura se o nome bater
                      this.suggestionsActive.set(false);
                      this.ui.show('Cadastro realizado. Confirme a assinatura.', 'SUCCESS'); 
                      this.db.tempFlowState.set(null); 
                  }, 200); 
              } else { 
                  this.db.tempFlowState.set(null); 
              }
          }
      }, { allowSignalWrites: true });
  }
  
  ngOnDestroy() { this.ui.isImageViewerOpen.set(false); this.ui.isSignatureMode.set(false); }

  removeReadonly(event: Event) { (event.target as HTMLElement).removeAttribute('readonly'); }
  encomendas = computed(() => this.db.encomendas());
  
  filteredEncomendas = computed(() => {
      let list = this.encomendas();
      const filter = this.activeFilter();
      const search = (this.searchQuery() || '').toLowerCase().trim();

      if (filter !== 'TODOS') {
          list = list.filter(e => e.status === filter);
      }

      if (search) {
          const unitRegex = /^([a-z0-9]+)[\/\-\s]+([a-z0-9]+)$/i;
          const unitMatch = search.match(unitRegex);

          if (unitMatch) {
              const qBlock = unitMatch[1].toLowerCase();
              const qApto = unitMatch[2].toLowerCase();
              list = list.filter(e => 
                  (e.bloco || '').toLowerCase() === qBlock && 
                  (e.apto || '').toLowerCase() === qApto
              );
          } else {
              list = list.filter(e => 
                  (e.destinatarioNome || '').toLowerCase().includes(search) ||
                  (e.codigoRastreio || '').toLowerCase().includes(search) ||
                  (e.apto || '').toLowerCase() === search ||
                  (e.bloco || '').toLowerCase() === search
              );
          }
      }

      const sortFunction = (a: Encomenda, b: Encomenda) => {
          if (filter === 'PENDENTE') {
              // DESCENDING ORDER FOR PENDING (Newest first)
              const dateA = new Date(a.dataEntrada).getTime();
              const dateB = new Date(b.dataEntrada).getTime();
              return dateB - dateA;
          } else {
              // DESCENDING ORDER FOR HISTORY (Delivered / Canceled)
              const dateA = new Date(a.dataEntrada).getTime();
              const dateB = new Date(b.dataEntrada).getTime();
              return dateB - dateA;
          }
      };

      list = list.sort(sortFunction);

      if (filter === 'PENDENTE') {
          const groups = new Map<string, Encomenda[]>();
          list.forEach(item => {
              const bloco = (item.bloco || '').trim();
              const apto = (item.apto || '').trim();
              let key = '';
              if (bloco && apto) key = `${bloco}|${apto}`;
              else key = `UNKNOWN|${(item.destinatarioNome || '').trim().toLowerCase()}`;
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(item);
          });

          const groupedList: (Encomenda | GroupedItem)[] = [];
          groups.forEach((items) => {
              if (items.length === 1) {
                  groupedList.push(items[0]); 
              } else {
                  const parent = items[0];
                  const uniqueNames = new Set(items.map(i => i.destinatarioNome.toUpperCase()));
                  const displayName = uniqueNames.size > 1 ? `${parent.destinatarioNome} + ${uniqueNames.size - 1}` : parent.destinatarioNome;

                  const groupItem = {
                      ...parent,
                      id: 'GROUP_' + parent.id, 
                      destinatarioNome: displayName,
                      groupCount: items.length,
                      groupItems: items, 
                      codigoRastreio: `${items.length} VOLUMES`, 
                      transportadora: 'AGRUPADO'
                  };
                  groupedList.push(groupItem);
              }
          });
          return groupedList;
      }
      return list;
  });

  displayedEncomendas = computed(() => {
      return this.filteredEncomendas().slice(0, this.displayLimit());
  });

  loadMore() {
      this.displayLimit.update(v => v + 50);
  }

  setFilter(filter: string) {
      this.activeFilter.set(filter);
      this.displayLimit.set(50);
  }

  groupedSearchResults = computed(() => { const q = (this.searchQuery() || '').toLowerCase().trim(); if (!q) return { pending: [], delivered: [] }; const all = this.encomendas(); const matches = all.filter(e => (e.destinatarioNome || '').toLowerCase().includes(q) || (e.bloco || '').toLowerCase().includes(q) || (e.apto || '').toLowerCase().includes(q) || (e.codigoRastreio || '').toLowerCase().includes(q) ); return { pending: matches.filter(e => e.status === 'PENDENTE').sort((a,b) => new Date(b.dataEntrada).getTime() - new Date(a.dataEntrada).getTime()), delivered: matches.filter(e => e.status === 'ENTREGUE').sort((a,b) => new Date(b.dataEntrada).getTime() - new Date(a.dataEntrada).getTime()) }; });
  foundResidents = computed(() => { const q = (this.searchQuery() || '').toLowerCase().trim(); if (q.length < 1) return []; const separatorRegex = /[\/\-\s]+/; const parts = q.split(separatorRegex); if (parts.length >= 2) { const b = parts[0].trim(); const a = parts[1].trim(); return this.db.moradores().filter(m => { const mBloco = (m.bloco || '').toLowerCase(); const mApto = (m.apto || '').toLowerCase(); const matchExact = mBloco === b && mApto === a; const matchPartial = mBloco.includes(b) && mApto.includes(a); return matchExact || matchPartial; }).sort((a) => (a.isPrincipal ? -1 : 1)).slice(0, 10); } return this.db.moradores().filter(m => (m.nome || '').toLowerCase().includes(q) || (m.bloco || '').toLowerCase() === q || (m.apto || '').toLowerCase() === q ).slice(0, 8); });
  
  stats = computed(() => { 
      const list = this.encomendas(); 
      return { 
          pending: list.filter(e => e.status === 'PENDENTE').length, 
          delivered: list.filter(e => e.status === 'ENTREGUE').length,
          canceled: list.filter(e => e.status === 'CANCELADA').length
      }; 
  });
  
  shelves = computed<Shelf[]>(() => { const pending = this.encomendas().filter(e => e.status === 'PENDENTE'); const shelfMap = new Map<string, Encomenda[]>(); pending.forEach(item => { let key = 'GERAL'; if (item.bloco) key = `BLOCO ${item.bloco}`; if (!shelfMap.has(key)) shelfMap.set(key, []); shelfMap.get(key)!.push(item); }); const shelvesArray: Shelf[] = []; shelfMap.forEach((items, title) => { shelvesArray.push({ title, items }); }); return shelvesArray.sort((a, b) => a.title.localeCompare(b.title)); });
  isDatabaseEmpty = computed(() => this.db.moradores().length === 0);
  handleScannerAccess(route: string, autoStart: boolean = false) { if (!this.auth.hasActiveFeatureAccess()) { this.ui.show('Funcionalidade bloqueada no plano atual.', 'WARNING'); return; } this.router.navigate([route], { queryParams: { autoStart } }); }
  openGlobalScanner() {
      if (!this.auth.hasActiveFeatureAccess()) { this.ui.show('Funcionalidade bloqueada no plano atual.', 'WARNING'); return; }
      this.scannerDataService.triggerAutoOpen();
      this.router.navigate(['/package/new']);
  }
  highlightScanner() { return !this.isDatabaseEmpty(); }
  openSearchModal() { this.searchQuery.set(''); this.showSearchModal.set(true); }
  closeSearchModal() { this.showSearchModal.set(false); this.searchExpandedCategory.set(null); if (!this.searchQuery()) { this.searchQuery.set(''); } }
  onInlineSearch() { setTimeout(() => { this.autoScrollToFirstResult(); }, 150); }
  autoScrollToFirstResult() { const items = this.filteredEncomendas(); if (items.length > 0) { const firstItem = items[0]; const elementId = 'pkg-' + firstItem.id; const element = document.getElementById(elementId); if (element) { element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } } }
  toggleSearchCategory(category: 'PENDENTE' | 'ENTREGUE') { if (this.searchExpandedCategory() === category) { this.searchExpandedCategory.set(null); } else { this.searchExpandedCategory.set(category); } }
  selectResidentFilter(resident: Morador) { this.searchQuery.set(resident.nome); this.viewMode.set('LIST'); this.activeFilter.set('TODOS'); this.showSearchModal.set(false); this.searchExpandedCategory.set(null); this.ui.show(`Mostrando itens de: ${resident.nome}`, 'INFO'); this.onInlineSearch(); }
  openCardDetails(item: Encomenda) { this.selectedSearchItem.set(item); }
  closeCardDetails() { this.selectedSearchItem.set(null); }
  openShelf(shelf: Shelf) { this.selectedShelf.set(shelf); }
  closeShelf() { this.selectedShelf.set(null); }
  currentShelfItems() { return this.selectedShelf()?.items || []; }
  closeUpdateCard() { this.showUpdateCard.set(false); localStorage.setItem('simbiose_version_ack', this.CURRENT_APP_VERSION); }
  openImage(event: Event, item: Encomenda | GroupedItem) { 
      event.stopPropagation(); 
      if (item.fotoBase64) { 
          this.ui.openImage(item.fotoBase64); 
      } 
  }
  viewGroupItemImage(base64?: string) { if(base64) this.ui.openImage(base64); }
  closeImage() { this.ui.closeImage(); this.viewingImage.set(null); }
  closeGroupModal() { this.selectedGroup.set(null); }
  
  startWithdrawal(item: Encomenda | GroupedItem, fromGroupModal: boolean = false) { 
      if ((item as GroupedItem).groupCount && (item as GroupedItem).groupCount > 1 && !fromGroupModal) { 
          this.groupActionItem.set(item as GroupedItem); 
          this.showGroupActionModal.set(true); 
          return; 
      } 
      this.withdrawalItem.set(item as Encomenda); 
      this.withdrawalStep.set('NAME'); 
      // SECURITY: Force empty input on start. Operator must verify identity.
      this.withdrawalReceiverName.set(''); 
      this.withdrawalSignature.set(null); 
      this.hasSharedProof.set(false); 
      this.showQuickRegisterModal.set(false); 
      this.isThirdPartyMode.set(false); 
      this.withdrawalReceiverCpf.set(''); 
      
      // AUTO-FILL REMOVED FOR SECURITY:
      // if (item.destinatarioNome) { this.withdrawalReceiverName.set(item.destinatarioNome); }

      if (item.bloco && item.apto) { 
          const neighbors = this.db.moradores().filter(m => m.bloco === item.bloco && m.apto === item.apto); 
          neighbors.sort((a, b) => { 
              const isOwnerA = (a.nome || '').toUpperCase() === (item.destinatarioNome || '').toUpperCase(); 
              const isOwnerB = (b.nome || '').toUpperCase() === (item.destinatarioNome || '').toUpperCase(); 
              if (isOwnerA && !isOwnerB) return -1; 
              if (!isOwnerA && isOwnerB) return 1; 
              if (a.isPrincipal && !b.isPrincipal) return -1; 
              if (!a.isPrincipal && b.isPrincipal) return 1; 
              return (a.nome || '').localeCompare(b.nome || ''); 
          }); 
          this.unitResidentsSuggestions.set(neighbors); 
          this.suggestionsActive.set(true); 
      } else { 
          this.unitResidentsSuggestions.set([]); 
          this.suggestionsActive.set(false); 
      } 
      if (fromGroupModal) this.closeGroupModal(); 
      this.closeCardDetails(); 
  }

  proceedGroupWithdrawal(retirarTodos: boolean) { const item = this.groupActionItem(); this.closeGroupActionModal(); if (!item) return; if (retirarTodos) { this.withdrawalItem.set(item); this.withdrawalStep.set('NAME'); this.withdrawalReceiverName.set(''); this.hasSharedProof.set(false); this.showQuickRegisterModal.set(false); this.isThirdPartyMode.set(false); if (item.bloco && item.apto) { const neighbors = this.db.moradores().filter(m => m.bloco === item.bloco && m.apto === item.apto); neighbors.sort((a, b) => { const isOwnerA = (a.nome || '').toUpperCase() === (item.destinatarioNome || '').toUpperCase(); const isOwnerB = (b.nome || '').toUpperCase() === (item.destinatarioNome || '').toUpperCase(); if (isOwnerA && !isOwnerB) return -1; if (!isOwnerA && isOwnerB) return 1; return (a.nome || '').localeCompare(b.nome || ''); }); this.unitResidentsSuggestions.set(neighbors); this.suggestionsActive.set(true); } else { this.unitResidentsSuggestions.set([]); this.suggestionsActive.set(false); } } else { this.selectedGroup.set(item as unknown as GroupedItem); } }
  closeGroupActionModal() { this.showGroupActionModal.set(false); this.groupActionItem.set(null); }
  closeQuickRegister() { this.showQuickRegisterModal.set(false); this.cancelWithdrawal(); }
  
  // --- REDIRECIONAMENTO COM FLUXO DE RETORNO ---
  proceedAsThirdParty() { this.isThirdPartyMode.set(true); this.withdrawalReceiverCpf.set(''); }
  confirmThirdParty() { if (!this.withdrawalReceiverCpf() || this.withdrawalReceiverCpf().length < 11) { this.ui.show('CPF é obrigatório para terceiros.', 'WARNING'); return; } this.withdrawalReceiverName.set(this.quickRegName()); this.showQuickRegisterModal.set(false); }
  toggleThirdParty() { this.isThirdPartyMode.update(v => !v); if (!this.isThirdPartyMode()) { this.withdrawalReceiverCpf.set(''); } }
  cancelWithdrawal() { this.withdrawalItem.set(null); this.withdrawalStep.set('NAME'); this.showQuickRegisterModal.set(false); }
  
  filteredResidents = computed(() => { 
      const term = (this.withdrawalReceiverName() || '').toUpperCase().trim(); 
      const unitResidents = this.unitResidentsSuggestions();
      if (term.length === 0) return unitResidents; 
      return unitResidents.filter(m => (m.nome || '').toUpperCase().includes(term)).slice(0, 4); 
  });
  
  showResidentSuggestions = computed(() => this.suggestionsActive() && this.withdrawalStep() === 'NAME' && !this.isThirdPartyMode() );
  onNameInput() { this.suggestionsActive.set(true); }
  onNameFocus() { this.suggestionsActive.set(true); }
  selectResident(resident: Morador) { this.withdrawalReceiverName.set(resident.nome); this.suggestionsActive.set(false); }
  goToSignature() { const name = this.withdrawalReceiverName().trim().toUpperCase(); if (!name || name.length < 3) { this.ui.show('Informe o nome de quem está retirando.', 'WARNING'); return; } if (this.isThirdPartyMode()) { if (!this.withdrawalReceiverCpf() || this.withdrawalReceiverCpf().length < 11) { this.ui.show('CPF Obrigatório para terceiros/entregadores.', 'WARNING'); this.ui.vibrate([100, 50, 100]); return; } } else { const validResidents = this.unitResidentsSuggestions(); if (validResidents.length > 0) { const isResident = validResidents.some(r => r.nome.toUpperCase() === name); if (!isResident) { this.ui.show('Apenas moradores listados podem retirar. Se não for, marque "Retirada por Terceiro".', 'WARNING'); this.ui.vibrate([100, 50, 100]); return; } } else { this.ui.show('Unidade sem moradores cadastrados. Marque como Terceiro para retirar.', 'WARNING'); return; } } this.withdrawalStep.set('SIGNATURE'); setTimeout(() => this.initSignatureCanvas(), 100); }
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private isDrawing = false;
  private lastPoint: { x: number, y: number } = { x: 0, y: 0 };
  initSignatureCanvas() { const canvas = document.querySelector('canvas') as HTMLCanvasElement; if (!canvas) return; setTimeout(() => { const dpr = window.devicePixelRatio || 1; const rect = canvas.parentElement!.getBoundingClientRect(); canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; this.canvasCtx = canvas.getContext('2d'); if (this.canvasCtx) { this.canvasCtx.scale(dpr, dpr); this.canvasCtx.lineWidth = 2.5; this.canvasCtx.lineCap = 'round'; this.canvasCtx.lineJoin = 'round'; this.canvasCtx.strokeStyle = '#000'; canvas.addEventListener('touchstart', (e) => this.startDraw(e), { passive: false }); canvas.addEventListener('touchmove', (e) => this.draw(e), { passive: false }); canvas.addEventListener('touchend', () => this.endDraw()); canvas.addEventListener('mousedown', (e) => this.startDraw(e)); canvas.addEventListener('mousemove', (e) => this.draw(e)); canvas.addEventListener('mouseup', () => this.endDraw()); } }, 300); }
  startDraw(e: MouseEvent | TouchEvent) { if (e.cancelable) e.preventDefault(); this.isDrawing = true; const pos = this.getPos(e); this.lastPoint = pos; this.canvasCtx?.beginPath(); this.canvasCtx?.arc(pos.x, pos.y, 0.5, 0, 2 * Math.PI); this.canvasCtx?.fill(); }
  draw(e: MouseEvent | TouchEvent) { if (!this.isDrawing || !this.canvasCtx) return; if (e.cancelable) e.preventDefault(); const currentPoint = this.getPos(e); const ctx = this.canvasCtx; const midPoint = { x: (this.lastPoint.x + currentPoint.x) / 2, y: (this.lastPoint.y + currentPoint.y) / 2 }; ctx.beginPath(); ctx.moveTo(this.lastPoint.x, this.lastPoint.y); ctx.quadraticCurveTo(this.lastPoint.x, this.lastPoint.y, midPoint.x, midPoint.y); ctx.lineTo(currentPoint.x, currentPoint.y); ctx.stroke(); this.lastPoint = currentPoint; }
  endDraw() { this.isDrawing = false; }
  getPos(e: MouseEvent | TouchEvent) { const canvas = e.target as HTMLCanvasElement; const rect = canvas.getBoundingClientRect(); const clientX = (e as TouchEvent).touches ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX; const clientY = (e as TouchEvent).touches ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY; return { x: (clientX - rect.left), y: (clientY - rect.top) }; }
  clearSignature() { const canvas = document.querySelector('canvas') as HTMLCanvasElement; if (canvas && this.canvasCtx) { const rect = canvas.getBoundingClientRect(); this.canvasCtx.clearRect(0, 0, rect.width, rect.height); } }

  async confirmSignature() {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const signatureBase64 = canvas.toDataURL('image/png').split(',')[1];
      this.withdrawalSignature.set(signatureBase64);
      this.isGeneratingProof.set(true);
      
      try {
          const item = this.withdrawalItem();
          if (!item) throw new Error('Item lost');
          const porteiro = this.auth.currentUser();
          const receiver = this.withdrawalReceiverName();
          const now = new Date().toISOString();
          const itemsToUpdate: Encomenda[] = [];
          
          if ((item as unknown as GroupedItem).groupItems) itemsToUpdate.push(...(item as unknown as GroupedItem).groupItems);
          else itemsToUpdate.push(item as Encomenda);

          for (const pkg of itemsToUpdate) {
              const update: Partial<Encomenda> = {
                  status: 'ENTREGUE',
                  dataSaida: now,
                  porteiroSaidaId: porteiro?.id,
                  quemRetirou: receiver,
                  assinaturaBase64: signatureBase64
              };
              if (this.isThirdPartyMode()) update.observacoes = `Retirado por Terceiro (CPF: ${this.withdrawalReceiverCpf()})`;
              await this.db.updateEncomenda(pkg.id, update);
          }
          
          this.ui.show('Saída Registrada!', 'SUCCESS');
          this.withdrawalStep.set('SUCCESS'); 
          this.ui.playTone('SUCCESS');
          
          // --- AUTOMATIC PDF SHARE TRIGGER ---
          // Gera o PDF silenciosamente e chama o envio via WhatsApp
          if (porteiro) {
              const { blob, url } = await this.pdf.generateWithdrawalProof(
                  item as Encomenda, 
                  porteiro, 
                  receiver, 
                  signatureBase64,
                  (item as unknown as GroupedItem).groupItems
              );
              
              // Dispara envio automático
              this.sendWhatsappAfterWithdraw(blob, url);
          }

      } catch (e) {
          console.error(e);
          this.ui.show('Erro ao registrar saída.', 'ERROR');
          this.cancelWithdrawal();
      } finally {
          this.isGeneratingProof.set(false);
      }
  }

  async sendWhatsappAfterWithdraw(pdfBlob?: Blob, pdfUrl?: string) {
      const item = this.withdrawalItem();
      if (!item) return;
      
      const receiver = this.withdrawalReceiverName();
      const itemsCount = (item as unknown as GroupedItem).groupCount || 1;
      const text = `*COMPROVANTE DE RETIRADA* ✅\n\nOlá,\nConfirmamos a retirada de *${itemsCount} volume(s)*.\n\n👤 Retirado por: ${receiver}\n📅 Data: ${new Date().toLocaleString()}\n\nObrigado!`;
      
      // Tenta compartilhar o arquivo PDF nativamente (Mobile)
      if (pdfBlob && navigator.share && navigator.canShare) {
          const file = new File([pdfBlob], `Comprovante_Retirada_${item.id.substring(0,6)}.pdf`, { type: 'application/pdf' });
          const shareData = {
              files: [file],
              title: 'Comprovante de Retirada',
              text: text
          };
          try {
              if (navigator.canShare(shareData)) {
                  await navigator.share(shareData);
                  this.hasSharedProof.set(true);
                  return;
              }
          } catch {}
      }

      // Fallback: WhatsApp Texto + Abrir PDF
      let phone = '';
      const resident = this.db.moradores().find(m => (m.nome || '').toUpperCase() === (item.destinatarioNome || '').toUpperCase());
      if (resident?.telefone) {
          phone = resident.telefone.replace(/\D/g, '');
          if (phone.length >= 8 && !phone.startsWith('55')) phone = '55' + phone;
      }
      
      const waUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(waUrl, '_blank');
      
      if (pdfUrl) {
          window.open(pdfUrl, '_blank');
      }
      
      this.hasSharedProof.set(true); 
  }
  
  isOverdue(item: Encomenda) { const now = new Date(); const entry = new Date(item.dataEntrada); const diffTime = Math.abs(now.getTime() - entry.getTime()); const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); return diffDays > 3; }
  daysInSystem(item: Encomenda) { const now = new Date(); const entry = new Date(item.dataEntrada); const diffTime = Math.abs(now.getTime() - entry.getTime()); return Math.floor(diffTime / (1000 * 60 * 60 * 24)); }
  async shareDeliveredProof(event: Event, item: Encomenda) { 
      event.stopPropagation(); 
      try {
          let porteiro = this.auth.currentUser();
          if (item.porteiroSaidaId) {
              const porteiros = this.db.porteiros();
              const found = porteiros.find(p => p.id === item.porteiroSaidaId);
              if (found) porteiro = found;
          }
          
          if (!porteiro) {
              this.ui.show('Erro: Usuário não identificado.', 'ERROR');
              return;
          }

          const result = await this.pdf.generateWithdrawalProof(
              item,
              porteiro,
              item.quemRetirou || 'Não identificado',
              item.assinaturaBase64 || ''
          );
          
          if (result && result.url) {
              window.open(result.url, '_blank');
          } else {
              this.ui.show('Erro ao gerar a 2ª via do comprovante.', 'ERROR');
          }
      } catch (e) {
          console.error('Erro ao gerar 2ª via:', e);
          this.ui.show('Erro ao gerar a 2ª via do comprovante.', 'ERROR');
      }
  }
  closeSuccessModal() { this.withdrawalItem.set(null); this.withdrawalStep.set('NAME'); this.hasSharedProof.set(false); this.searchQuery.set(''); }
  closeScanner() {}

  // --- BOTÃO INBOX SISTEMA (LÓGICA) ---
  showInboxButton = computed(() => {
      const lastLogin = localStorage.getItem('last_login_time');
      if (!lastLogin) return false;
      const loginTime = new Date(lastLogin).getTime();
      const now = new Date().getTime();
      const hoursSinceLogin = (now - loginTime) / (1000 * 60 * 60);
      return hoursSinceLogin >= 7;
  });

  navigateToInbox() {
      this.router.navigate(['/admin'], { queryParams: { tab: 'inbox' } });
  }
}
