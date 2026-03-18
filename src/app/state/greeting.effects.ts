
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { map, mergeMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { GreetingService } from '../services/greeting.service';
import * as GreetingActions from './greeting.actions';

@Injectable()
export class GreetingEffects {
  private actions$ = inject(Actions);
  private greetingService = inject(GreetingService);

  loadGreetings$ = createEffect(() =>
    this.actions$.pipe(
      // Escuta a action de "Load"
      ofType(GreetingActions.loadGreetings),
      // Chama o serviço
      mergeMap(() =>
        this.greetingService.getGreetings().pipe(
          // Sucesso: Dispara a action de Success com os dados
          map((greetings) => GreetingActions.loadGreetingsSuccess({ greetings })),
          // Erro: (Simplificado) Retorna um observable vazio ou action de erro
          catchError((error) => {
            console.error('Error loading greetings', error);
            return of({ type: '[Greeting] Load Error' });
          })
        )
      )
    )
  );
}
