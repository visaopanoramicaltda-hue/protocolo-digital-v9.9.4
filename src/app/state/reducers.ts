
import { ActionReducerMap } from '@ngrx/store';
import { AppState } from './app.state';
import { greetingReducer } from './greeting.reducer';
import { userReducer } from './user.reducer';
import { moradorReducer } from './morador.reducer';

export const reducers: ActionReducerMap<AppState> = {
  greetings: greetingReducer,
  user: userReducer,
  moradores: moradorReducer
};
