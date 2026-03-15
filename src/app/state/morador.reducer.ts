
import { createReducer, on } from '@ngrx/store';
import { Morador } from '../../services/db.service';
import * as MoradorActions from './morador.actions';

export const initialMoradorState: ReadonlyArray<Morador> = [];

export const moradorReducer = createReducer(
  initialMoradorState,

  // Load Success: Substitui o estado inteiro (Imutável)
  on(MoradorActions.loadMoradoresSuccess, (_state, { moradores }) => moradores),

  // Add Success: Cria novo array com spread (Imutável)
  // Nota: Em uma app real, o Effect dispararia o Success após o DB confirmar. 
  // Aqui assumimos otimismo ou fluxo direto para simplificar a demo.
  on(MoradorActions.addMorador, (state, { morador }) => [...state, morador]),

  // Update: Map retorna novo array, Object spread retorna novo objeto
  on(MoradorActions.updateMorador, (state, { morador }) => 
    state.map(m => m.id === morador.id ? { ...m, ...morador } : m)
  ),

  // Delete: Filter retorna novo array
  on(MoradorActions.deleteMorador, (state, { id }) => 
    state.filter(m => m.id !== id)
  )
);
