import { afterEach, expect, it, vi } from 'vitest';

/**
 * A virtual clock over `window.setTimeout`, so an interval costs no real time. Only the handles the
 * module actually uses are stubbed; anything else it reached for would surface here as a failure.
 */
function fakeDom() {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  const win: Record<string, ((event: unknown) => void)[]> = {};
  const doc: Record<string, ((event: unknown) => void)[]> = {};
  const on = (map: typeof win) => (type: string, fn: (event: unknown) => void) => { (map[type] ??= []).push(fn); };
  const off = (map: typeof win) => (type: string, fn: (event: unknown) => void) => { map[type] = (map[type] ?? []).filter(f => f !== fn); };

  vi.stubGlobal('Event', class { constructor(public type: string) {} });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: on(doc), removeEventListener: off(doc) });
  vi.stubGlobal('window', {
    setTimeout: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    // Stubbed so that reintroducing interval polling fails on the timing assertions below rather
    // than on a missing global.
    setInterval: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval: (id: number) => { timers.delete(id); },
    addEventListener: on(win), removeEventListener: off(win),
    dispatchEvent: (event: { type: string }) => { (win[event.type] ?? []).forEach(fn => fn(event)); return true; },
  });

  const drain = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  return {
    drain,
    now: () => now,
    pending: () => timers.size,
    listeners: () => (doc.visibilitychange?.length ?? 0) + (win['brsteel:operations-changed']?.length ?? 0),
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due; now = timer.at;
        if (timer.every) timers.set(id, { ...timer, at: now + timer.every }); else timers.delete(id);
        timer.fn(); await drain();
      }
      now = target; await drain();
    },
  };
}

/** Records when each load starts and hands back the resolver, so a load can be held open. */
function pausableLoad(dom: ReturnType<typeof fakeDom>) {
  const starts: number[] = [];
  let finish = () => {};
  return { starts, finish: () => finish(), load: () => { starts.push(dom.now()); return new Promise<void>(resolve => { finish = resolve; }); } };
}

afterEach(() => vi.unstubAllGlobals());

it('leaves a full interval after a slow load instead of reloading straight away', async () => {
  const dom = fakeDom();
  const { subscribeOperation } = await import('@/lib/operation-client');
  const { starts, finish, load } = pausableLoad(dom);
  const stop = subscribeOperation(load, () => {}, () => {});
  await dom.drain();
  expect(starts).toEqual([0]);

  // A load slower than the interval used to be followed immediately by the next one, because the
  // interval kept firing underneath it and queued a reload. Nothing may be pending while it runs.
  await dom.advance(28000);
  expect(starts).toEqual([0]);
  expect(dom.pending()).toBe(0);

  finish(); await dom.drain();
  await dom.advance(9999);
  expect(starts).toEqual([0]);
  await dom.advance(1);
  expect(starts).toEqual([0, 38000]);
  stop();
});

it('still reloads the moment a reported change lands during a load', async () => {
  const dom = fakeDom();
  const { subscribeOperation, notifyOperationsChanged } = await import('@/lib/operation-client');
  const { starts, finish, load } = pausableLoad(dom);
  const stop = subscribeOperation(load, () => {}, () => {});
  await dom.drain();

  // The load in flight may have read the data the change replaced, so this one does queue.
  await dom.advance(5000);
  notifyOperationsChanged(); await dom.drain();
  expect(starts).toEqual([0]);
  finish(); await dom.drain();
  expect(starts).toEqual([0, 5000]);
  stop();
});

it('never polls a hidden tab and detaches everything once unsubscribed', async () => {
  const dom = fakeDom();
  const { subscribeOperation } = await import('@/lib/operation-client');
  const { starts, finish, load } = pausableLoad(dom);
  const stop = subscribeOperation(load, () => {}, () => {});
  await dom.drain(); finish(); await dom.drain();
  expect(dom.listeners()).toBe(2);

  (globalThis as unknown as { document: { visibilityState: string } }).document.visibilityState = 'hidden';
  await dom.advance(60000);
  expect(starts).toEqual([0]);

  (globalThis as unknown as { document: { visibilityState: string } }).document.visibilityState = 'visible';
  stop();
  await dom.advance(60000);
  expect(starts).toEqual([0]);
  expect(dom.pending()).toBe(0);
  expect(dom.listeners()).toBe(0);
});
