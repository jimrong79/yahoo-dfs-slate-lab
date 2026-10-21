import { generateLineup } from './optimizer.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ ok: true, result: generateLineup(data.slate, data.settings) }); }
  catch (error) { self.postMessage({ ok: false, error: error.message }); }
};
