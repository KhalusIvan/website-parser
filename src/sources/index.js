// Registry of all supported websites.
// To add a new source: create src/sources/<id>.js (see vroda.js for the shape) and add it here.
import vroda from './vroda.js';
import jrl from './jrl.js';
import mrd from './mrd.js';
import babyliss from './babyliss.js';
import gama from './gama.js';
import immortal from './immortal.js';
import jaguar from './jaguar.js';
import kucheryawiy from './kucheryawiy.js';
import moser from './moser.js';
import spl from './spl.js';
import spl4barber from './spl4barber.js';

export const sources = [vroda, jrl, mrd, babyliss, gama, immortal, jaguar, kucheryawiy, moser, spl, spl4barber];

export function getSource(id) {
  const source = sources.find((s) => s.id === id);
  if (!source) {
    throw new Error(`Unknown source "${id}". Available: ${sources.map((s) => s.id).join(', ')}`);
  }
  return source;
}

/** Plain JSON description of the sources (used by the web UI). */
export function describeSources() {
  return sources.map(({ id, name, website, description, languages, modes }) => ({
    id,
    name,
    website,
    description,
    languages,
    modes,
  }));
}
