
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { Greeting } from '../models/greeting.model';

@Injectable({
  providedIn: 'root'
})
export class GreetingService {
  
  // Simula uma chamada HTTP
  getGreetings(): Observable<ReadonlyArray<Greeting>> {
    const mockData: Greeting[] = [
      { id: '1', text: 'Hello from NgRx!' },
      { id: '2', text: 'Immutability is key.' },
      { id: '3', text: 'Angular 18+ Rocks.' }
    ];
    
    // Retorna os dados após 1 segundo de delay simulado
    return of(mockData).pipe(delay(1000));
  }
}
