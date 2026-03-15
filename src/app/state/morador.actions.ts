
import { createAction, props } from '@ngrx/store';
import { Morador } from '../../services/db.service'; // Usando a interface existente

// Load
export const loadMoradores = createAction(
  '[Morador] Load Moradores'
);

export const loadMoradoresSuccess = createAction(
  '[Morador] Load Moradores Success',
  props<{ moradores: ReadonlyArray<Morador> }>()
);

export const loadMoradoresFailure = createAction(
  '[Morador] Load Moradores Failure',
  props<{ error: string }>()
);

// Add
export const addMorador = createAction(
  '[Morador] Add Morador',
  props<{ morador: Morador }>()
);

export const addMoradorSuccess = createAction(
  '[Morador] Add Morador Success',
  props<{ morador: Morador }>()
);

// Update
export const updateMorador = createAction(
  '[Morador] Update Morador',
  props<{ morador: Morador }>()
);

// Delete
export const deleteMorador = createAction(
  '[Morador] Delete Morador',
  props<{ id: string }>()
);
