
import { MetaReducer, ActionReducer, Action } from '@ngrx/store';
import { AppState } from './app.state';
import { deepFreeze } from '../core/immutability/deep-freeze';

/**
 * MetaReducer que congela o estado recursivamente após cada ação.
 * Isso garante que nenhum componente modifique o estado diretamente (mutação),
 * forçando o uso correto de reducers e ações para manter a integridade unidirecional.
 */
export const freezeStateMetaReducer: MetaReducer<AppState> = (reducer: ActionReducer<AppState>) => {
  return (state: AppState | undefined, action: Action) => {
    const nextState = reducer(state, action);
    
    // Em desenvolvimento, congela o estado para detectar mutações acidentais.
    // Se um componente tentar fazer `state.user.name = 'X'`, o JS lançará um erro
    // pois o objeto estará congelado.
    if (nextState) {
      try {
        deepFreeze(nextState);
      } catch (e) {
        console.error('[NgRx] State Mutation Detected or Freeze Failed!', e);
      }
    }
    
    return nextState;
  };
};

// Lista de meta-reducers ativos na aplicação
export const metaReducers: MetaReducer<AppState>[] = [freezeStateMetaReducer];
