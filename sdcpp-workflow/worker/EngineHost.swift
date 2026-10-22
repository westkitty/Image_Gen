import Foundation
import Darwin

// Stable GUI-session TCC responsibility identity for the Python worker and engines.
let child = Process()
child.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/python3")
child.arguments = [NSHomeDirectory() + "/.dexdiffusion-engine/engine-worker.py", "serve"]
child.environment = ProcessInfo.processInfo.environment.merging(["PYTHONUNBUFFERED": "1"]) { _, new in new }
var receivedSignal: Int32 = 0
signal(SIGTERM) { value in receivedSignal = value }
signal(SIGINT) { value in receivedSignal = value }
do {
    try child.run()
    while child.isRunning {
        if receivedSignal != 0 { child.terminate(); receivedSignal = 0 }
        Thread.sleep(forTimeInterval: 0.2)
    }
    exit(child.terminationStatus)
} catch {
    FileHandle.standardError.write(Data("Engine host: \(error)\n".utf8))
    exit(1)
}
