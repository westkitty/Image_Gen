'use strict';
// Runs `node server.js` for a browser suite and guarantees it never outlives the suite: if the parent process
// disappears for ANY reason (including SIGKILL, which no handler can catch) the child server is stopped and this exits.
//   node server-supervisor.js <parentPid> <serverCwd>
const { spawn } = require('child_process');
const parent = Number(process.argv[2]);
const child = spawn(process.execPath, ['server.js'], { cwd: process.argv[3], env: process.env, stdio: 'ignore' });
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  try { child.kill('SIGTERM'); } catch (_) {}
  setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} process.exit(0); }, 2500).unref();
}
child.on('exit', code => process.exit(code == null ? 0 : code));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setInterval(() => { try { process.kill(parent, 0); } catch (_) { stop(); } }, 1000);
