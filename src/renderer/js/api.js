// Acesso ao processo principal e estado compartilhado da interface.

/** @type {any} */
let state = null;
const listeners = new Set();

export const call = (method, ...args) => window.pw.call(method, ...args);

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setState(next) {
  state = next;
  document.documentElement.setAttribute('data-bs-theme', next.settings.theme === 'light' ? 'light' : 'dark');
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error(err);
    }
  }
}

export async function initState() {
  window.pw.on('state', setState);
  setState(await call('state:get'));
  return state;
}

export const onEvent = (name, cb) => window.pw.on(name, cb);

export const pw = { call, getState, subscribe, initState, onEvent };
