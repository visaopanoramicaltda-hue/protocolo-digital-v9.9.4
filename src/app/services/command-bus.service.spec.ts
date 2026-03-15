import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { CommandBusService } from './command-bus.service';
import { loadGreetings, addGreeting } from '../state/greeting.actions';

// Declare test globals to avoid compilation errors when types are missing
declare const describe: any;
declare const beforeEach: any;
declare const it: any;
declare const expect: any;
declare const jasmine: any;

describe('CommandBusService (Architectural Facade)', () => {
  let service: CommandBusService;
  let storeSpy: any;

  beforeEach(() => {
    const spy = jasmine.createSpyObj('Store', ['dispatch']);
    TestBed.configureTestingModule({
      providers: [
        CommandBusService,
        { provide: Store, useValue: spy }
      ]
    });
    service = TestBed.inject(CommandBusService);
    storeSpy = TestBed.inject(Store);
  });

  it('should dispatch "loadGreetings" action when scope is "greeting" and action is "load"', () => {
    // Act
    service.dispatch({ scope: 'greeting', action: 'load' });
    
    // Assert
    expect(storeSpy.dispatch).toHaveBeenCalledWith(loadGreetings());
  });

  it('should dispatch "addGreeting" action with payload correctly', () => {
    // Arrange
    const payload = { id: '99', text: 'Command Payload' };
    
    // Act
    service.dispatch({ scope: 'greeting', action: 'add', payload });
    
    // Assert
    expect(storeSpy.dispatch).toHaveBeenCalledWith(addGreeting({ greeting: payload }));
  });

  it('should throw error for unknown scope to prevent side effects leaks', () => {
    expect(() => service.dispatch({ scope: 'unknown' as any, action: 'test' }))
      .toThrowError(/Escopo desconhecido/);
  });

  it('should throw error if payload is missing for "add" action', () => {
    expect(() => service.dispatch({ scope: 'greeting', action: 'add' }))
      .toThrowError(/Payload is required/);
  });
});