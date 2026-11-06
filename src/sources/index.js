// Registry of all supported websites.
// To add a new source: create src/sources/<id>.js (see vroda.js for the shape) and add it here.
import vroda from './vroda.js';

export const sources = [vroda];

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
