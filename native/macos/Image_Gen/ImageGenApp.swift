import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var consoleProcess: Process?

    private let projectRoot = ProcessInfo.processInfo.environment["IMAGE_GEN_ROOT"] ?? "/Users/andrew/Image_Gen"
    private let consoleURL = URL(string: "http://127.0.0.1:31337")!

    private var operatorRoot: String { "\(projectRoot)/operator-console" }
    private var workflowRoot: String { "\(projectRoot)/sdcpp-workflow" }
    private var wrapperLog: String { "\(operatorRoot)/Image_Gen-macos-wrapper.log" }
    private var consoleLog: String { "\(operatorRoot)/server.log" }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        ensureServicesThenLoad()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window.makeKeyAndOrderFront(nil)
        } else {
            window.makeKeyAndOrderFront(nil)
        }
        NSApp.activate(ignoringOtherApps: true)
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        consoleProcess?.terminate()
    }

    @objc private func reloadPage() {
        webView.reload()
    }

    @objc private func openLogs() {
        let manager = FileManager.default
        if manager.fileExists(atPath: consoleLog) {
            NSWorkspace.shared.open(URL(fileURLWithPath: consoleLog))
        } else if manager.fileExists(atPath: wrapperLog) {
            NSWorkspace.shared.open(URL(fileURLWithPath: wrapperLog))
        } else {
            NSWorkspace.shared.open(URL(fileURLWithPath: operatorRoot))
        }
    }

    @objc private func openInBrowser() {
        NSWorkspace.shared.open(consoleURL)
    }

    private func buildWindow() {
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self

        statusLabel = NSTextField(labelWithString: "Starting Image_Gen...")
        statusLabel.font = NSFont.systemFont(ofSize: 12)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byTruncatingTail

        let content = NSView()
        content.translatesAutoresizingMaskIntoConstraints = false
        webView.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(webView)
        content.addSubview(statusLabel)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: statusLabel.topAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
            statusLabel.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12),
            statusLabel.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -8),
            statusLabel.heightAnchor.constraint(equalToConstant: 18)
        ])

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Image_Gen"
        window.center()
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildMenu() {
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        let viewMenuItem = NSMenuItem()
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        mainMenu.addItem(fileMenuItem)
        mainMenu.addItem(viewMenuItem)

        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "Quit Image_Gen", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appMenuItem.submenu = appMenu

        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(NSMenuItem(title: "Open Logs", action: #selector(openLogs), keyEquivalent: "l"))
        fileMenu.addItem(NSMenuItem(title: "Open in Browser", action: #selector(openInBrowser), keyEquivalent: "b"))
        fileMenuItem.submenu = fileMenu

        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(NSMenuItem(title: "Reload", action: #selector(reloadPage), keyEquivalent: "r"))
        viewMenuItem.submenu = viewMenu

        NSApp.mainMenu = mainMenu
    }

    private func ensureServicesThenLoad() {
        setStatus("Checking local console and BigMac tunnel...")
        DispatchQueue.global(qos: .userInitiated).async {
            self.ensureOperatorConsole()
            self.ensureSdcppTunnel()
            DispatchQueue.main.async {
                self.setStatus("Loading Image_Gen at \(self.consoleURL.absoluteString)")
                self.webView.load(URLRequest(url: self.consoleURL))
            }
        }
    }

    private func ensureOperatorConsole() {
        if commandOK("curl -fsS --max-time 2 \(consoleURL.absoluteString)/api/version >/dev/null", timeout: 4) {
            appendLog("operator-console already listening on 127.0.0.1:31337")
            return
        }

        appendLog("starting operator-console node server")
        let process = Process()
        process.currentDirectoryURL = URL(fileURLWithPath: operatorRoot)
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", "server.js"]
        let logHandle = FileHandle(forWritingAtPath: consoleLog) ?? createLogHandle(consoleLog)
        process.standardOutput = logHandle
        process.standardError = logHandle
        do {
            try process.run()
            consoleProcess = process
        } catch {
            appendLog("failed to start operator-console: \(error.localizedDescription)")
            DispatchQueue.main.async { self.setStatus("Could not start local console. Open Logs for details.") }
            return
        }

        for _ in 0..<30 {
            if commandOK("curl -fsS --max-time 2 \(consoleURL.absoluteString)/api/version >/dev/null", timeout: 4) {
                appendLog("operator-console started")
                return
            }
            Thread.sleep(forTimeInterval: 1)
        }
        appendLog("operator-console did not answer within timeout")
        DispatchQueue.main.async { self.setStatus("Local console did not answer within timeout. Open Logs for details.") }
    }

    private func ensureSdcppTunnel() {
        let statusScript = "\(workflowRoot)/bin/sdcpp-server-status.sh"
        let startScript = "\(workflowRoot)/bin/sdcpp-server-start.sh"
        let status = runShell("cd \(shellQuote(workflowRoot)) && \(shellQuote(statusScript))", timeout: 40)
        appendLog(status.output)
        if status.output.contains("Server + tunnel appear UP") {
            DispatchQueue.main.async { self.setStatus("BigMac server and tunnel are up.") }
            return
        }

        DispatchQueue.main.async { self.setStatus("Starting BigMac server tunnel...") }
        let start = runShell("cd \(shellQuote(workflowRoot)) && \(shellQuote(startScript))", timeout: 120)
        appendLog(start.output)
        let finalStatus = runShell("cd \(shellQuote(workflowRoot)) && \(shellQuote(statusScript))", timeout: 40)
        appendLog(finalStatus.output)
        DispatchQueue.main.async {
            if finalStatus.output.contains("Server + tunnel appear UP") {
                self.setStatus("BigMac server and tunnel are up.")
            } else {
                self.setStatus("BigMac server/tunnel is not ready. Open Logs for details.")
            }
        }
    }

    private func commandOK(_ command: String, timeout: TimeInterval) -> Bool {
        runShell(command, timeout: timeout).code == 0
    }

    private func runShell(_ command: String, timeout: TimeInterval) -> (code: Int32, output: String) {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = ["-lc", command]
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
        } catch {
            return (127, error.localizedDescription)
        }

        let semaphore = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in semaphore.signal() }
        if semaphore.wait(timeout: .now() + timeout) == .timedOut {
            process.terminate()
            return (124, "Timed out: \(command)")
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return (process.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private func setStatus(_ text: String) {
        statusLabel.stringValue = text
    }

    private func appendLog(_ text: String) {
        let line = "[\(Date())] \(text)\n"
        guard let data = line.data(using: .utf8) else { return }
        let handle = createLogHandle(wrapperLog)
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
    }

    private func createLogHandle(_ path: String) -> FileHandle {
        if !FileManager.default.fileExists(atPath: path) {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
        return FileHandle(forWritingAtPath: path) ?? FileHandle.standardError
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.setActivationPolicy(.regular)
app.delegate = delegate
app.run()
