import { greetingReducer, initialState } from './greeting.reducer';
import * as GreetingActions from './greeting.actions';
import { Greeting } from '../models/greeting.model';

describe('Greeting Reducer (Immutability & Purity)', () => {
  
  it('should return the default state in initial state', () => {
    const action = { type: 'Unknown' };
    const state = greetingReducer(initialState, action);

    expect(state).toBe(initialState);
  });

  it('should add a greeting and preserve immutability of the previous state', () => {
    // 1. Estado Inicial
    const initial = initialState;
    const newGreeting: Greeting = { id: '1', text: 'Immutability Test' };
    
    // 2. Executar Ação
    const action = GreetingActions.addGreeting({ greeting: newGreeting });
    const nextState = greetingReducer(initial, action);

    // 3. Verificações de Lógica
    expect(nextState.length).toBe(1);
    expect(nextState[0]).toEqual(newGreeting);

    // 4. Verificações de Imutabilidade (CRÍTICO)
    // O estado inicial deve permanecer vazio (não pode ter sofrido push/mutation)
    expect(initial.length).toBe(0);
    // A referência do novo estado deve ser diferente do inicial
    expect(nextState).not.toBe(initial);
  });

  it('should replace state on load success without mutating original', () => {
    const initial = initialState;
    const loadedGreetings: Greeting[] = [
        { id: '10', text: 'Loaded A' },
        { id: '20', text: 'Loaded B' }
    ];
    
    const action = GreetingActions.loadGreetingsSuccess({ greetings: loadedGreetings });
    const nextState = greetingReducer(initial, action);

    // Lógica
    expect(nextState).toEqual(loadedGreetings);
    expect(nextState.length).toBe(2);

    // Imutabilidade
    expect(nextState).not.toBe(initial);
    expect(initial.length).toBe(0);
  });
});