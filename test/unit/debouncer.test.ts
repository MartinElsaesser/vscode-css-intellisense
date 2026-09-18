import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Debouncer } from '../../src/index/debouncer';

describe('Debouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs only the latest callback after the delay', () => {
    const calls: string[] = [];
    const debouncer = new Debouncer();
    debouncer.schedule('key', 200, () => calls.push('first'));
    debouncer.schedule('key', 200, () => calls.push('second'));
    vi.advanceTimersByTime(250);
    expect(calls).toEqual(['second']);
    debouncer.dispose();
  });

  it('tracks keys independently', () => {
    const calls: string[] = [];
    const debouncer = new Debouncer();
    debouncer.schedule('a', 100, () => calls.push('a'));
    debouncer.schedule('b', 200, () => calls.push('b'));
    vi.advanceTimersByTime(150);
    expect(calls).toEqual(['a']);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual(['a', 'b']);
    debouncer.dispose();
  });

  it('cancel prevents a pending run', () => {
    const calls: string[] = [];
    const debouncer = new Debouncer();
    debouncer.schedule('key', 100, () => calls.push('run'));
    debouncer.cancel('key');
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([]);
    debouncer.dispose();
  });

  it('dispose clears pending runs', () => {
    const calls: string[] = [];
    const debouncer = new Debouncer();
    debouncer.schedule('key', 100, () => calls.push('run'));
    debouncer.dispose();
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([]);
  });
});
