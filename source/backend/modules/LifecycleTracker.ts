import { EventEmitter } from 'events';

/**
 * LifecycleTracker
 *
 * A type-safe helper for managing the lifecycle of plugins and modules.
 * It tracks timeouts, intervals, and event listener registrations to ensure
 * they can all be safely cleaned up with a single call to cleanupAll().
 */
export class LifecycleTracker {
  private _timeouts: Set<NodeJS.Timeout> = new Set();
  private _intervals: Set<NodeJS.Timeout> = new Set();
  private _listeners: { emitter: EventEmitter; event: string; fn: (...args: any[]) => void }[] = [];

  /**
   * Track a timeout handle returned by setTimeout.
   * @param handle The timeout handle to track.
   * @returns The same handle, for inline use.
   */
  public trackTimeout(handle: NodeJS.Timeout): NodeJS.Timeout {
    this._timeouts.add(handle);
    return handle;
  }

  /**
   * Cancel and untrack a previously tracked timeout.
   * Safe to call even if the handle has already fired or been cleared.
   * @param handle The timeout handle to clear.
   */
  public clearTimeout(handle: NodeJS.Timeout): void {
    clearTimeout(handle);
    this._timeouts.delete(handle);
  }

  /**
   * Track an interval handle returned by setInterval.
   * @param handle The interval handle to track.
   * @returns The same handle, for inline use.
   */
  public trackInterval(handle: NodeJS.Timeout): NodeJS.Timeout {
    this._intervals.add(handle);
    return handle;
  }

  /**
   * Cancel and untrack a previously tracked interval.
   * Safe to call even if the handle has already been cleared.
   * @param handle The interval handle to clear.
   */
  public clearInterval(handle: NodeJS.Timeout): void {
    clearInterval(handle);
    this._intervals.delete(handle);
  }

  /**
   * Track an EventEmitter listener registration.
   * @param emitter The EventEmitter to attach the listener to.
   * @param event The event name.
   * @param fn The listener function.
   * @returns The same function, for inline use.
   */
  public trackListener<T extends (...args: any[]) => void>(
    emitter: EventEmitter,
    event: string,
    fn: T
  ): T {
    this._listeners.push({ emitter, event, fn });
    return fn;
  }

  /**
   * Cancel all tracked timeouts, clear all tracked intervals, and remove all
   * tracked event listeners. Safe to call multiple times (idempotent).
   */
  public cleanupAll(): void {
    for (const handle of this._timeouts) {
      clearTimeout(handle);
    }
    this._timeouts.clear();

    for (const handle of this._intervals) {
      clearInterval(handle);
    }
    this._intervals.clear();

    for (const { emitter, event, fn } of this._listeners) {
      try {
        if (emitter && typeof emitter.removeListener === 'function') {
          emitter.removeListener(event, fn);
        }
      } catch (error) {
        // Ignore errors during cleanup, but we could log them if needed.
      }
    }
    this._listeners = [];
  }
}
