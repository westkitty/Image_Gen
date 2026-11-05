'use strict';
// Pose detection for ControlNet OpenPose: runs bin/vision-pose (Apple Vision, built into macOS; no model download)
// and returns its OpenPose COCO-18 JSON. The Studio loads that into the Puppet Master editor, which renders the
// OpenPose stick figure the ControlNet reads.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const VISION_POSE_BIN = path.join(__dirname, 'bin', 'vision-pose');
const TIMEOUT_MS = 20000;

class PoseError extends Error {
  constructor(message, code) { super(message); this.name = 'PoseError'; this.code = code; this.status = code === 'unavailable' ? 503 : code === 'bad_output' ? 500 : 422; }
}

function isAvailable(bin = VISION_POSE_BIN) { return fs.existsSync(bin); }

// Validate the detector's document; never pass through anything but the OpenPose fields the editor imports.
function parsePoseOutput(stdout) {
  let doc;
  try { doc = JSON.parse(String(stdout).trim()); } catch (_) { throw new PoseError('Pose detector returned unreadable output', 'bad_output'); }
  const w = doc && doc.canvas_width, h = doc && doc.canvas_height;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || !Array.isArray(doc.people) || doc.people.length > 10) throw new PoseError('Pose detector returned an invalid document', 'bad_output');
  const people = doc.people.map(p => {
    const a = p && p.pose_keypoints_2d;
    if (!Array.isArray(a) || a.length !== 54 || !a.every(v => typeof v === 'number' && Number.isFinite(v))) throw new PoseError('Pose detector returned an invalid person', 'bad_output');
    for (let i = 0; i < 18; i++) {
      const x = a[i * 3], y = a[i * 3 + 1], c = a[i * 3 + 2];
      if (c < 0 || c > 1 || (c > 0 && (x < 0 || y < 0 || x > w || y > h))) throw new PoseError('Pose detector returned a joint outside the image', 'bad_output');
    }
    return { person_id: [-1], pose_keypoints_2d: a, face_keypoints_2d: [], hand_left_keypoints_2d: [], hand_right_keypoints_2d: [] };
  });
  return { version: 1.3, canvas_width: w, canvas_height: h, people };
}

function detectPose(imagePath, { bin = VISION_POSE_BIN, run = execFile, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!isAvailable(bin)) return reject(new PoseError('The pose detector is not installed on this Mac (bin/vision-pose).', 'unavailable'));
    run(bin, ['--image', imagePath], { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const line = String(stderr || '').split('\n').find(l => l.startsWith('Error:'));
        return reject(new PoseError(err.killed ? `Pose detection did not finish within ${timeoutMs} ms` : (line ? line.replace(/^Error:\s*/, 'Pose detection failed: ') : 'Pose detection failed'), err.killed ? 'timeout' : 'vision_failed'));
      }
      try { resolve(parsePoseOutput(stdout)); } catch (e) { reject(e); }
    });
  });
}

module.exports = { VISION_POSE_BIN, PoseError, isAvailable, parsePoseOutput, detectPose };
