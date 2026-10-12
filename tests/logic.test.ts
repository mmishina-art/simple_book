import { describe, expect, it } from 'vitest';
import { initialState, reset, tap } from '../src/logic';

describe('tap', () => {
  it('カウントが 1 増える', () => {
    expect(tap(initialState()).count).toBe(1);
  });

  it('最高記録を更新する', () => {
    const s = tap(tap(initialState(1)));
    expect(s).toEqual({ count: 2, best: 2 });
  });

  it('最高記録は下がらない', () => {
    expect(tap(initialState(10)).best).toBe(10);
  });
});

describe('reset', () => {
  it('カウントだけ 0 に戻し、最高記録は残す', () => {
    expect(reset({ count: 5, best: 7 })).toEqual({ count: 0, best: 7 });
  });
});
