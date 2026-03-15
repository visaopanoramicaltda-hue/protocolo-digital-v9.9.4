
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { Morador } from '../services/db.service';

// Feature Selector
export const selectMoradorState = createFeatureSelector<ReadonlyArray<Morador>>('moradores');

// Select All
export const selectAllMoradores = createSelector(
  selectMoradorState,
  (moradores) => moradores
);

// Select Total Count
export const selectMoradoresCount = createSelector(
  selectMoradorState,
  (moradores) => moradores.length
);

// Select by ID (Factory function pattern)
export const selectMoradorById = (id: string) => createSelector(
  selectMoradorState,
  (moradores) => moradores.find(m => m.id === id)
);

// Select by Unit (Bloco/Apto) - Útil para a busca rápida
export const selectMoradoresByUnit = (bloco: string, apto: string) => createSelector(
  selectMoradorState,
  (moradores) => moradores.filter(m => 
    m.bloco.toLowerCase() === bloco.toLowerCase() && 
    m.apto.toLowerCase() === apto.toLowerCase()
  )
);
