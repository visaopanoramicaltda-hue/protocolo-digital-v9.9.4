
import { createReducer, on } from '@ngrx/store';
import { Greeting } from '../models/greeting.model';
import * as GreetingActions from './greeting.actions';

// O estado inicial é um array de leitura apenas (ReadonlyArray)
// Isso impede métodos como .push() ou .splice() via TypeScript
export const initialState: ReadonlyArray<Greeting> = [];

export const greetingReducer = createReducer(
  initialState,

  // Ao carregar com sucesso, substituímos o estado pelo novo array.
  // Não há mutação, apenas substituição de referência.
  on(GreetingActions.loadGreetingsSuccess, (_state, { greetings }) => greetings),

  // Ao adicionar, criamos um NOVO array contendo os itens antigos (...) mais o novo item.
  // O operador spread (...) garante a imutabilidade estrutural.
  on(GreetingActions.addGreeting, (state, { greeting }) => [...state, greeting])
);
