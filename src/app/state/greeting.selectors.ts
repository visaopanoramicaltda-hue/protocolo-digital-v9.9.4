
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { Greeting } from '../models/greeting.model';

// Seleciona a fatia 'greetings' do estado global.
// O nome deve corresponder à chave usada no objeto de reducers (veremos na configuração do store).
export const selectGreetingsState = createFeatureSelector<ReadonlyArray<Greeting>>('greetings');

// Seletor para obter a lista completa
export const selectAllGreetings = createSelector(
  selectGreetingsState,
  (greetings) => greetings
);

// Seletor derivado para contar itens (Exemplo de computação derivada)
export const selectGreetingsCount = createSelector(
  selectGreetingsState,
  (greetings) => greetings.length
);
