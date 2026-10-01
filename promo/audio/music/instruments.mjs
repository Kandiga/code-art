// (work in progress - full header written at the end)
import { REGISTRY, getInstrument } from './instruments/common.mjs';
import './instruments/keys.mjs';
import './instruments/strings.mjs';
import './instruments/winds.mjs';
import './instruments/choir.mjs';
export { harpGliss } from './instruments/keys.mjs';
export { windRun } from './instruments/winds.mjs';
export const INSTRUMENTS = Object.fromEntries(REGISTRY);
export const render = (id, notes, opts) => getInstrument(id).render(notes, opts);
export const list = () => [...REGISTRY.keys()];
