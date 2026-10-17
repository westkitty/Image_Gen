'use strict';

// A remote job can finish its validated pass, publish its output, and complete
// its remote cleanup just before the cancellation handler signals the local
// shell. Preserve that natural success only when the worker emitted both
// explicit success and cleanup markers for a run-scoped job.
function successfulPassAfterCancelSignal({ cancelInFlight, exitCode, stdout = '', stderr = '' } = {}) {
  if (!cancelInFlight || exitCode === 0) return false;
  const out = String(stdout);
  const combined = out + '\n' + String(stderr);
  return /^SDCPP_RUN_ID: 20\d{6}-\d{6}-[A-Za-z0-9_-]{1,80}$/m.test(out) &&
    out.includes('==== PASS ====') &&
    combined.includes('SDCPP_REMOTE_CLEANUP: OK') &&
    !combined.includes('SDCPP_REMOTE_CLEANUP: FAIL');
}

module.exports = { successfulPassAfterCancelSignal };
