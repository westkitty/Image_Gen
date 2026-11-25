'use strict';
// Why a request was refused, for people: what is true now and what to do next. Every refusal happens before any
// generation request, so nothing was generated. DexDiffusion never unloads a model another app loaded.
const REFUSAL_TEXT = Object.freeze({
  external: 'Another app has an Ollama model loaded on Big Mac, so DexDiffusion waited and did not start. Nothing was generated and that model was left alone. Try again once it unloads, or unload it in the app that is using it.',
  unknown: 'DexDiffusion could not read which model Ollama has loaded on Big Mac, so it did not start. Nothing was generated. Check that Ollama is running on Big Mac, then try again.',
  'compute-busy': 'Big Mac is busy with another DexDiffusion job, so this did not start. Try again when that job finishes; the Job Center shows it.',
  'job-storage-unavailable': 'DexDiffusion could not record this job, so it did not start. Nothing was generated. Try again; if it repeats, look at the System screen.',
});
const REFUSAL_DEFAULT = 'Big Mac is not available to the local language model right now, so this did not start. Nothing was generated. Try again in a moment.';
const refusalText = reason => (Object.prototype.hasOwnProperty.call(REFUSAL_TEXT, reason) ? REFUSAL_TEXT[reason] : REFUSAL_DEFAULT);

module.exports = { refusalText, REFUSAL_TEXT };
