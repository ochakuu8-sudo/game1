const DEFAULT_STORAGE_KEY = 'medal-arcade-economy-v1';

const DEFAULT_STATE = {
  medals: 250,
  bankedMedals: 0,
  lifetimeIn: 0,
  lifetimeOut: 250,
  sessionIn: 0,
  sessionOut: 0,
  plays: 0,
  lastNet: 0,
  history: [],
};

function cloneDefaultState() {
  return {
    ...DEFAULT_STATE,
    history: [],
  };
}

function normalizeState(saved) {
  return {
    ...cloneDefaultState(),
    ...(saved && typeof saved === 'object' ? saved : {}),
    history: Array.isArray(saved?.history) ? saved.history.slice(-20) : [],
  };
}

export function createMedalEconomy(options = {}) {
  const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
  const storage = options.storage || globalThis.localStorage;
  let state = cloneDefaultState();

  function save() {
    try {
      storage?.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage can fail in private contexts. The in-memory economy still works.
    }
  }

  function load() {
    try {
      const raw = storage?.getItem(storageKey);
      state = raw ? normalizeState(JSON.parse(raw)) : cloneDefaultState();
    } catch {
      state = cloneDefaultState();
    }
    save();
  }

  function snapshot() {
    return {
      ...state,
      sessionNet: state.sessionOut - state.sessionIn,
      lifetimeNet: state.lifetimeOut - state.lifetimeIn,
    };
  }

  function canSpend(amount) {
    return Number.isFinite(amount) && amount > 0 && state.medals >= amount;
  }

  function spend(amount, source = 'spend') {
    const cost = Math.max(0, Math.floor(amount));
    if (!canSpend(cost)) return false;
    state.medals -= cost;
    state.lifetimeIn += cost;
    state.sessionIn += cost;
    state.history.push({ type: 'in', source, amount: cost, at: Date.now() });
    state.history = state.history.slice(-20);
    save();
    return true;
  }

  function payout(amount, source = 'payout') {
    const win = Math.max(0, Math.floor(amount));
    if (win <= 0) return 0;
    state.medals += win;
    state.lifetimeOut += win;
    state.sessionOut += win;
    state.history.push({ type: 'out', source, amount: win, at: Date.now() });
    state.history = state.history.slice(-20);
    save();
    return win;
  }

  function completePlay({ cost = 0, payout: playPayout = 0, source = 'game' } = {}) {
    const net = Math.floor(playPayout) - Math.floor(cost);
    state.plays += 1;
    state.lastNet = net;
    state.history.push({ type: 'play', source, cost, payout: playPayout, net, at: Date.now() });
    state.history = state.history.slice(-20);
    save();
    return net;
  }

  function reset() {
    state = cloneDefaultState();
    save();
  }

  load();

  return {
    get state() {
      return snapshot();
    },
    canSpend,
    spend,
    payout,
    completePlay,
    reset,
  };
}
