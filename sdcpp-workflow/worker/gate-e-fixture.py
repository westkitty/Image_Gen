"""One-shot Gate E fixture creation from the existing EngineHost worker."""
import hashlib
import hmac
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
from contextlib import ExitStack

VOLUME = Path('/Volumes/wc2tb')
VOLUME_UUID = '888EF24D-E36E-473A-A195-5CADD598E4F8'
TEST_ROOT = 'DexDiffusion-OptionA-Test'
SENTINEL = b'---\ngate_e_fixture: gate-e-wc2tb-read\n---\n'
DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _volume_identity():
    data = plistlib.loads(subprocess.run(
        ['/usr/sbin/diskutil', 'info', '-plist', str(VOLUME)], check=True,
        capture_output=True, timeout=5).stdout)
    if (data.get('VolumeUUID') != VOLUME_UUID or data.get('MountPoint') != str(VOLUME)
            or data.get('FilesystemType') != 'apfs' or data.get('WritableVolume') is not True):
        raise ValueError('Gate E volume identity or writable mount mismatch')
    return data['VolumeUUID']


def authorize(worker_root, token):
    if not isinstance(token, str) or not re.fullmatch('[a-f0-9]{64}', token):
        raise ValueError('Gate E fixture authorization failed')
    root = os.open(worker_root, DIRECTORY)
    try:
        name = 'gate-e-bootstrap.sha256'
        with os.fdopen(os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=root), 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError('Gate E credential file is unsafe')
            expected = stream.read(66)
        supplied = hashlib.sha256(token.encode()).hexdigest().encode() + b'\n'
        if not hmac.compare_digest(expected, supplied):
            raise ValueError('Gate E fixture authorization failed')
        os.unlink(name, dir_fd=root)
        os.fsync(root)
    finally:
        os.close(root)


def create_fixture():
    identity = _volume_identity()
    return _create(VOLUME, identity)


def _create(volume, identity):
    with ExitStack() as resources:
        def opened(name, flags, parent=None, mode=0o600):
            fd = os.open(name, flags, mode=mode, dir_fd=parent)
            resources.callback(os.close, fd)
            return fd

        parent = opened(volume.parent, DIRECTORY)
        mount = opened(volume.name, DIRECTORY, parent)
        mounted = os.fstat(mount)
        if mounted.st_uid not in (0, os.getuid()) or mounted.st_dev == os.fstat(parent).st_dev:
            raise ValueError('Gate E volume owner or device mismatch')
        device = mounted.st_dev

        def create_dir(name, root):
            os.mkdir(name, mode=0o700, dir_fd=root)
            fd = opened(name, DIRECTORY, root)
            info = os.fstat(fd)
            if info.st_dev != device or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError('Gate E fixture owner, permissions or device mismatch')
            return fd

        root = create_dir(TEST_ROOT, mount)
        state = create_dir('state', root)
        runs = create_dir('runs', root)
        probe = create_dir('gate-e-probe', runs)
        name = 'ui-run-card.md'
        sentinel = opened(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, probe)
        if os.write(sentinel, SENTINEL) != len(SENTINEL):
            raise OSError('short Gate E fixture write')
        os.fsync(sentinel)
        for fd in (probe, runs, state, root, mount):
            os.fsync(fd)
        readback = opened(name, os.O_RDONLY | os.O_NOFOLLOW, probe)
        facts = os.fstat(readback)
        if (not stat.S_ISREG(facts.st_mode) or facts.st_uid != os.getuid()
                or facts.st_dev != device or os.read(readback, len(SENTINEL) + 1) != SENTINEL):
            raise ValueError('Gate E fixture readback failed')
        return {'volume_uuid': identity, 'device': device, 'uid': facts.st_uid,
                'worker_pid': os.getpid(), 'sha256': hashlib.sha256(SENTINEL).hexdigest()}
