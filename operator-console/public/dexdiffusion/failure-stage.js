// Maps a job's first failed gate (and, when no gate exists, its log) to the finalization stage that failed, so
// "failed near the end" is reported as a specific stage rather than a generic error. Pure, shared by browser and server.
// Stages follow the order of the real pipeline; not every backend passes through every stage (MFLUX has no external VAE
// stage, for example) and nothing here claims a stage ran unless the gate/log says it did.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.DexFailureStage = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const STAGES = ['PREFLIGHT', 'UPLOAD', 'SAMPLING', 'VAE_DECODING', 'IMAGE_ENCODING', 'REMOTE_OUTPUT_VALIDATION', 'TRANSFER', 'CHECKSUM_VERIFICATION', 'CANONICALIZATION', 'METADATA_FINALIZATION', 'RESULT_PUBLICATION', 'CLEANUP'];
  const LABEL = {
    PREFLIGHT: 'Pre-flight checks', UPLOAD: 'Uploading inputs to Big Mac', SAMPLING: 'Sampling', VAE_DECODING: 'VAE decoding', IMAGE_ENCODING: 'Encoding the image',
    REMOTE_OUTPUT_VALIDATION: 'Validating the output on Big Mac', TRANSFER: 'Transferring the result to the MacBook', CHECKSUM_VERIFICATION: 'Verifying the transferred file',
    CANONICALIZATION: 'Committing to canonical storage', METADATA_FINALIZATION: 'Recording image metadata', RESULT_PUBLICATION: 'Publishing the result to the interface', CLEANUP: 'Cleaning up temporary files',
  };
  // gate-name fragments (as emitted by sdcpp-workflow/bin/*.sh and the console) -> stage, most specific first
  const RULES = [
    [/user-cancelled|cancel/i, null],
    [/scp-init|upload/i, 'UPLOAD'],
    [/pre-?flight|model-(present|size|slot)|vae-present|tunnel-down|sd-cli-help|args|command|lora-dir|model-path|server-run-dir|init-img/i, 'PREFLIGHT'],
    [/generator-exit|sampling|timeout/i, 'SAMPLING'],
    [/vae|decode/i, 'VAE_DECODING'],
    [/encode|png-redact/i, 'IMAGE_ENCODING'],
    [/remote-png|server-png$|output-content/i, 'REMOTE_OUTPUT_VALIDATION'],
    [/(^|-)scp(-|$)|server-png-copy|transfer/i, 'TRANSFER'],
    [/checksum|digest|sha/i, 'CHECKSUM_VERIFICATION'],
    [/canonical|publication-(link|commit)|collision/i, 'CANONICALIZATION'],
    [/metadata|image-meta|run-index/i, 'METADATA_FINALIZATION'],
    [/publish|result-publication/i, 'RESULT_PUBLICATION'],
    [/cleanup|remote-cleanup/i, 'CLEANUP'],
  ];
  // Where the image is still recoverable after a failure at this stage (output exists somewhere that is not yet lost).
  const OUTPUT_MAY_EXIST = { REMOTE_OUTPUT_VALIDATION: true, TRANSFER: true, CHECKSUM_VERIFICATION: true, CANONICALIZATION: true, METADATA_FINALIZATION: true, RESULT_PUBLICATION: true, CLEANUP: true };
  function classify(gate, logText) {
    const g = String(gate || '');
    let stage = null, matched = false;
    for (const [re, st] of RULES) if (re.test(g)) { stage = st; matched = true; break; }
    if (!matched && logText) {
      const t = String(logText);
      if (/SDCPP_REMOTE_CLEANUP: FAIL/.test(t)) stage = 'CLEANUP';
      else if (/=== Copying PNG to MacBook ===/.test(t) && !/=== Finalizing canonical image ===/.test(t)) stage = 'TRANSFER';
      else if (/=== Finalizing canonical image ===/.test(t)) stage = 'CANONICALIZATION';
      else if (/=== Verifying remote PNG ===/.test(t)) stage = 'REMOTE_OUTPUT_VALIDATION';
    }
    if (!stage) return { stage: null, label: null, outputMayExist: false, text: g ? 'Failed at gate ' + g : 'Failed' };
    const outputMayExist = !!OUTPUT_MAY_EXIST[stage];
    return { stage, label: LABEL[stage], outputMayExist,
      text: 'Failed while ' + LABEL[stage].charAt(0).toLowerCase() + LABEL[stage].slice(1) + (g ? ' (' + g + ')' : '') + (outputMayExist ? '. A rendered image may still be recoverable; nothing already saved was changed.' : '.') };
  }
  return { STAGES, LABEL, classify };
});
