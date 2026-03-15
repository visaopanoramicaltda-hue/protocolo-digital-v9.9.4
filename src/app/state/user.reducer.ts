
import { createReducer } from '@ngrx/store';
import { User } from '../models/user.model';

export const initialUserState: User = {
  id: '',
  name: 'Guest'
};

export const userReducer = createReducer(
  initialUserState
);
