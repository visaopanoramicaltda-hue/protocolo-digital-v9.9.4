
import { Greeting } from '../models/greeting.model';
import { User } from '../models/user.model';
import { Morador } from '../../services/db.service';

export interface AppState {
  // Estados imutáveis via readonly e ReadonlyArray
  readonly greetings: ReadonlyArray<Greeting>;
  readonly user: User;
  
  // Novo estado de domínio
  readonly moradores: ReadonlyArray<Morador>;
}
