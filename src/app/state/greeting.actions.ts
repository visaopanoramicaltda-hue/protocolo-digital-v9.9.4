
import { createAction, props } from '@ngrx/store';
import { Greeting } from '../models/greeting.model';

export const loadGreetings = createAction(
  '[Greeting] Load Greetings'
);

export const loadGreetingsSuccess = createAction(
  '[Greeting] Load Greetings Success',
  props<{ greetings: ReadonlyArray<Greeting> }>()
);

export const addGreeting = createAction(
  '[Greeting] Add Greeting',
  props<{ greeting: Greeting }>()
);
