// ルール・計算は DOM に触れない純関数にして、tests/ で単体テストする。

export interface State {
  count: number;
  best: number;
}

export const initialState = (best = 0): State => ({ count: 0, best });

export function tap(state: State): State {
  const count = state.count + 1;
  return { count, best: Math.max(state.best, count) };
}

export function reset(state: State): State {
  return { count: 0, best: state.best };
}
