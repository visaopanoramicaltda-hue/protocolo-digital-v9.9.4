
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { AppState } from '../../state/app.state';
import { selectAllGreetings } from '../../state/greeting.selectors';
import { CommandBusService } from '../../services/command-bus.service';

@Component({
  selector: 'app-example',
  imports: [AsyncPipe],
  template: `
    <div class="p-4 font-sans text-gray-800">
      <h2 class="text-xl font-bold mb-4">Arquitetura Angular + NgRx + CommandBus</h2>
      
      <div class="flex gap-2 mb-6">
        <button (click)="load()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
          Carregar (Load)
        </button>
        <button (click)="add()" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition">
          Adicionar (Add)
        </button>
      </div>

      <div class="border rounded p-4 bg-gray-50">
        <h3 class="font-semibold mb-2">Estado Atual (Greetings):</h3>
        
        @for (g of greetings$ | async; track g.id) {
          <div class="p-2 border-b border-gray-200 last:border-0 hover:bg-white transition">
            <span class="font-mono text-xs text-gray-500 mr-2">[{{ g.id.substring(0, 4) }}]</span>
            <span>{{ g.text }}</span>
          </div>
        } @empty {
          <div class="text-gray-500 italic">Nenhum item carregado. Clique em Carregar.</div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExampleComponent {
  private store = inject(Store<AppState>);
  private commandBus = inject(CommandBusService);

  // Seleção de dados reativa (Observable)
  greetings$ = this.store.select(selectAllGreetings);

  load() {
    // Dispara comando para carregar dados (Effect -> Service -> Action)
    this.commandBus.dispatch({
      scope: 'greeting',
      action: 'load'
    });
  }

  add() {
    // Dispara comando para adicionar item (Reducer -> State Update)
    this.commandBus.dispatch({
      scope: 'greeting',
      action: 'add',
      payload: { 
        id: crypto.randomUUID(), 
        text: `Item gerado em ${new Date().toLocaleTimeString()}` 
      }
    });
  }
}
