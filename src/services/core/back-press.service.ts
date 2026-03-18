import { Injectable } from '@angular/core';

/**
 * A service to manage back press/navigation events, especially for Android devices.
 * Components can register handlers to perform actions (like closing a modal)
 * instead of allowing default back navigation.
 */
@Injectable({ providedIn: 'root' })
export class BackPressService {
  /**
   * Handlers are functions that return `true` if they handled the back press event,
   * or `false` otherwise. They are stored in a LIFO (Last-In, First-Out) stack.
   */
  private handlers: (() => boolean)[] = [];

  /**
   * Registers a handler function. The most recently registered handler is checked first.
   * @param handler - The function to execute on back press. Should return `true` if it handled the event.
   */
  register(handler: () => boolean): void {
    this.handlers.unshift(handler); // Add to the front of the array
  }

  /**
   * Unregisters a handler function to prevent memory leaks.
   * @param handler - The exact same handler function instance that was registered.
   */
  unregister(handler: () => boolean): void {
    this.handlers = this.handlers.filter(h => h !== handler);
  }

  /**
   * Called by the global back press listener (e.g., in AppComponent).
   * It iterates through handlers and executes the first one that returns `true`.
   * @returns `true` if any handler consumed the event, `false` otherwise.
   */
  handleBackPress(): boolean {
    for (const handler of this.handlers) {
      if (handler()) {
        return true; // Event was handled, stop further processing.
      }
    }
    return false; // No handler took the event, allow default navigation.
  }
}