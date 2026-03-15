
import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { AppState } from '../state/app.state';
import { loadGreetings, addGreeting } from '../state/greeting.actions';
import { addMorador, updateMorador, deleteMorador, loadMoradores } from '../state/morador.actions';
import { Greeting } from '../models/greeting.model';
import { Morador } from '../../services/db.service';

export type CommandScope = 'greeting' | 'user' | 'morador';

export interface Command {
  scope: CommandScope;
  action: 'load' | 'add' | 'update' | 'delete' | string;
  payload?: any;
}

@Injectable({
  providedIn: 'root'
})
export class CommandBusService {
  private store = inject(Store<AppState>);

  dispatch(cmd: Command): void {
    // Roteamento de comandos baseado no Escopo (Domain Boundary)
    switch (cmd.scope) {
      case 'greeting':
        this.handleGreeting(cmd.action, cmd.payload);
        break;
      case 'user':
        console.warn('User command scope not implemented yet.');
        break;
      case 'morador':
        this.handleMorador(cmd.action, cmd.payload);
        break;
      default:
        const _exhaustiveCheck: never = cmd.scope as never;
        throw new Error(`Escopo desconhecido: ${cmd.scope}`);
    }
  }

  private handleGreeting(action: string, payload?: any): void {
    switch (action) {
      case 'load':
        this.store.dispatch(loadGreetings());
        break;
      case 'add':
        if (!payload) throw new Error('Payload is required for "add" action in greeting scope.');
        this.store.dispatch(addGreeting({ greeting: payload as Greeting }));
        break;
      default:
        throw new Error(`Ação de Greeting desconhecida: ${action}`);
    }
  }

  private handleMorador(action: string, payload?: any): void {
    switch (action) {
        case 'load':
            this.store.dispatch(loadMoradores());
            break;
        case 'add':
            if (!payload) throw new Error('Payload required for add morador');
            this.store.dispatch(addMorador({ morador: payload as Morador }));
            break;
        case 'update':
            if (!payload) throw new Error('Payload required for update morador');
            this.store.dispatch(updateMorador({ morador: payload as Morador }));
            break;
        case 'delete':
            if (!payload || typeof payload !== 'string') throw new Error('ID string required for delete morador');
            this.store.dispatch(deleteMorador({ id: payload }));
            break;
        default:
            throw new Error(`Ação de Morador desconhecida: ${action}`);
    }
  }
}
