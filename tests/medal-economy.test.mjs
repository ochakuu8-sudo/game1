import assert from 'node:assert/strict';
import { createMedalEconomy } from '../src/medalEconomy.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const storage = memoryStorage();
const economy = createMedalEconomy({ storage, storageKey: 'test-economy' });

assert.equal(economy.state.medals, 250);
assert.equal(economy.canSpend(10), true);

assert.equal(economy.spend(10, 'pin-ball'), true);
assert.equal(economy.state.medals, 240);
assert.equal(economy.state.sessionIn, 10);

assert.equal(economy.payout(17, 'pin-ore'), 17);
assert.equal(economy.state.medals, 257);
assert.equal(economy.state.sessionOut, 17);

const net = economy.completePlay({ cost: 10, payout: 17, source: 'medal-pin' });
assert.equal(net, 7);
assert.equal(economy.state.lastNet, 7);
assert.equal(economy.state.sessionNet, 7);
assert.equal(economy.state.plays, 1);

assert.equal(economy.spend(10000, 'too-expensive'), false);
assert.equal(economy.state.medals, 257);

const loaded = createMedalEconomy({ storage, storageKey: 'test-economy' });
assert.equal(loaded.state.medals, 257);
assert.equal(loaded.state.sessionNet, 7);

loaded.reset();
assert.equal(loaded.state.medals, 250);
assert.equal(loaded.state.sessionNet, 0);

console.log('medal economy tests passed');
