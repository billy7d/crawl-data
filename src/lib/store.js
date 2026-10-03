// Tiny JSON-file persistence for the watchlist and search history.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('data');
fs.mkdirSync(DIR, { recursive: true });

export function jsonStore(name, initial) {
  const file = path.join(DIR, name);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = structuredClone(initial);
  }
  let timer = null;
  const flush = () => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, file);
  };
  return {
    get: () => data,
    set(next) {
      data = next;
      clearTimeout(timer);
      timer = setTimeout(flush, 200);
    },
    flushNow: flush,
  };
}
