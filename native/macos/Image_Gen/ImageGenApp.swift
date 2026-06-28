import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var consoleProcess: Process?

    private let projectRoot = ProcessInfo.processInfo.environment["IMAGE_GEN_ROOT"] ?? "/Users/andrew/Image_Gen"
    private let serverBaseURL = URL(string: "http://127.0.0.1:31337")!
    private let consoleURL = URL(string: "http://127.0.0.1:31337/dexdiffusion/")!

    private var operatorRoot: String { "\(projectRoot)/operator-console" }
    private var workflowRoot: String { "\(projectRoot)/sdcpp-workflow" }
    private var wrapperLog: String { "\(operatorRoot)/Image_Gen-macos-wrapper.log" }
    private var consoleLog: String { "\(operatorRoot)/server.log" }
    private var expectedConsoleCwd: String { operatorRoot }
    private let wrapperLaunchPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        ensureServicesThenLoad()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
        webView = nil
        statusLabel = nil
    }

    private func showMainWindow() {
        if window == nil {
            buildWindow()
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        // Give WKWebView first-responder status so paste targets the active DOM element.
        if let wv = webView { window.makeFirstResponder(wv) }
    }

    func applicationWillTerminate(_ notification: Notification) {
        consoleProcess?.terminate()
    }

    // MARK: - Menu actions

    @objc private func showAbout() {
        let alert = NSAlert()
        alert.messageText = "Image_Gen"
        alert.informativeText = "Local AI image generation console\nApp URL: \(consoleURL.absoluteString)\nProject: \(projectRoot)"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    // MARK: - Paste bridge (DexDictate / automation support)

    // Converts a Swift string to a JSON-encoded JavaScript string literal (safe for interpolation).
    private func jsStringLiteral(_ value: String) -> String {
        let wrapper = [value]
        guard JSONSerialization.isValidJSONObject(wrapper) else {
            return "\"\""
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: wrapper, options: [])
            guard let encodedArray = String(data: data, encoding: .utf8), encodedArray.count >= 2 else {
                return "\"\""
            }
            let start = encodedArray.index(after: encodedArray.startIndex)
            let end = encodedArray.index(before: encodedArray.endIndex)
            return String(encodedArray[start..<end])
        } catch {
            return "\"\""
        }
    }

    // Recursively converts/sanitizes values to ensure they are JSON-safe.
    // Unsafe types are converted if supported, otherwise omitted (returning nil).
    private func sanitizeToJSONSafeValue(_ value: Any) -> Any? {
        if let str = value as? String {
            return str
        }
        if let num = value as? NSNumber {
            if num.doubleValue.isNaN || num.doubleValue.isInfinite {
                return nil
            }
            return num
        }
        if let boolVal = value as? Bool {
            return boolVal
        }
        if value is NSNull {
            return value
        }
        if let dict = value as? [String: Any] {
            var sanitized: [String: Any] = [:]
            for (k, v) in dict {
                if let safeV = sanitizeToJSONSafeValue(v) {
                    sanitized[k] = safeV
                }
            }
            return sanitized
        }
        if let array = value as? [Any] {
            var sanitized: [Any] = []
            for v in array {
                if let safeV = sanitizeToJSONSafeValue(v) {
                    sanitized.append(safeV)
                }
            }
            return sanitized
        }
        if let url = value as? URL {
            return url.absoluteString
        }
        if let url = value as? NSURL {
            return url.absoluteString
        }
        if let data = value as? Data {
            return data.base64EncodedString()
        }
        return nil
    }

    // Creates a completely JSON-safe dictionary of pasteboard contents.
    private func makeJSONSafePastePayload(from pasteboard: NSPasteboard) -> [String: Any] {
        var rawPayload: [String: Any] = [:]
        
        if let text = pasteboard.string(forType: .string) {
            rawPayload["text"] = text
        }
        
        if let html = pasteboard.string(forType: .html) {
            rawPayload["html"] = html
        }
        
        if let nsUrl = NSURL(from: pasteboard) {
            rawPayload["url"] = nsUrl
        }
        
        if pasteboard.types?.contains(.png) == true, let data = pasteboard.data(forType: .png) {
            rawPayload["image_png_base64"] = data
        } else if pasteboard.types?.contains(.tiff) == true, let data = pasteboard.data(forType: .tiff) {
            rawPayload["image_tiff_base64"] = data
        }
        
        // Deep-sanitize raw payload to ensure no invalid types remain
        guard let sanitized = sanitizeToJSONSafeValue(rawPayload) as? [String: Any] else {
            return [:]
        }
        return sanitized
    }

    // Diagnostic helper showing key name and type of fields in a dictionary or value.
    private func describeJSONTypes(_ object: Any) -> String {
        if let dict = object as? [String: Any] {
            let descriptions = dict.map { "\($0.key): \(type(of: $0.value))" }
            return "Dictionary: {\(descriptions.joined(separator: ", "))}"
        } else if let array = object as? [Any] {
            let descriptions = array.map { "\(type(of: $0))" }
            return "Array: [\(descriptions.joined(separator: ", "))]"
        } else {
            return "\(type(of: object))"
        }
    }

    @objc func customPaste(_ sender: Any?) {
        guard let wv = webView else { return }

        // Ensure the WKWebView is first responder so the JS activeElement is current.
        wv.window?.makeFirstResponder(wv)

        let payload = makeJSONSafePastePayload(from: NSPasteboard.general)

        // If there is no plain text on the pasteboard or it's empty, we fall back immediately to native WebKit paste.
        guard let text = payload["text"] as? String, !text.isEmpty else {
            wv.perform(NSSelectorFromString("paste:"), with: sender)
            return
        }

        // Before serialization, verify the object is valid for JSON serialization.
        guard JSONSerialization.isValidJSONObject(payload) else {
            appendLog("paste-bridge: Invalid JSON object constructed: \(describeJSONTypes(payload))")
            wv.perform(NSSelectorFromString("paste:"), with: sender)
            return
        }

        let jsonString: String
        do {
            let data = try JSONSerialization.data(withJSONObject: payload, options: [])
            jsonString = String(data: data, encoding: .utf8) ?? "{}"
        } catch {
            appendLog("paste-bridge: JSON serialization failed: \(error.localizedDescription)")
            wv.perform(NSSelectorFromString("paste:"), with: sender)
            return
        }

        let js = """
        (function() {
          var payload = \(jsonString);
          var text = payload.text || '';
          if (!text) return { ok: false, reason: 'no-text-payload' };

          var el = document.activeElement;
          if (!el) return { ok: false, reason: 'no-active-element' };
          var tag = el.tagName ? el.tagName.toLowerCase() : '';
          var type = (el.type || '').toLowerCase();
          var isTextInput = (tag === 'textarea') ||
                            (tag === 'input' && type !== 'password' && type !== 'hidden' && type !== 'file' && type !== 'checkbox' && type !== 'radio');
          var isCE = el.isContentEditable;
          if (!isTextInput && !isCE) return { ok: false, reason: 'not-editable' };
          if (el.disabled || el.readOnly) return { ok: false, reason: 'secure-or-disabled' };

          if (isTextInput) {
            var start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
            var end   = typeof el.selectionEnd   === 'number' ? el.selectionEnd   : el.value.length;
            el.value = el.value.slice(0, start) + text + el.value.slice(end);
            var caret = start + text.length;
            el.selectionStart = caret;
            el.selectionEnd   = caret;
            try { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertFromPaste', data: text })); } catch(e) {}
            try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e) {}
            return { ok: true, mode: tag };
          }
          if (isCE) {
            try { document.execCommand('insertText', false, text); } catch(e) {
              var sel = window.getSelection();
              if (sel && sel.rangeCount) {
                sel.deleteFromDocument();
                var range = sel.getRangeAt(0);
                range.insertNode(document.createTextNode(text));
                range.collapse(false);
              }
            }
            try { el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertFromPaste', data: text })); } catch(e) {}
            return { ok: true, mode: 'contenteditable' };
          }
          return { ok: false, reason: 'unexpected' };
        })()
        """

        wv.evaluateJavaScript(js) { [weak self] result, error in
            guard let self = self else { return }
            if let err = error {
                self.appendLog("paste-bridge error: \(err.localizedDescription)")
                // Fall back: let WebKit handle it natively.
                DispatchQueue.main.async { wv.perform(NSSelectorFromString("paste:"), with: sender) }
                return
            }
            if let dict = result as? [String: Any], let ok = dict["ok"] as? Bool, !ok {
                let reason = dict["reason"] as? String ?? "unknown"
                if reason == "no-active-element" || reason == "not-editable" || reason == "no-text-payload" {
                    // Not in a text field or no text payload; fall through to WebKit.
                    DispatchQueue.main.async { wv.perform(NSSelectorFromString("paste:"), with: sender) }
                }
                // "secure-or-disabled": silently skip — don't paste into protected fields.
            }
        }
    }

    override func responds(to selector: Selector) -> Bool {
        if selector == NSSelectorFromString("customPaste:") { return true }
        return super.responds(to: selector)
    }

    @objc func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(customPaste(_:)) {
            return NSPasteboard.general.canReadItem(withDataConformingToTypes: [NSPasteboard.PasteboardType.string.rawValue])
        }
        return true
    }

    @objc private func reloadPage() {
        webView?.reload()
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

    @objc private func closeWindow() {
        window?.close()
    }

    @objc private func zoomIn() {
        guard let wv = webView else { return }
        wv.pageZoom = min(wv.pageZoom * 1.1, 3.0)
    }

    @objc private func zoomOut() {
        guard let wv = webView else { return }
        wv.pageZoom = max(wv.pageZoom / 1.1, 0.25)
    }

    @objc private func actualSize() {
        webView?.pageZoom = 1.0
    }

    @objc private func copyErrorReport() {
        var parts: [String] = []
        parts.append("=== Image_Gen Error Report ===")
        parts.append("Date: \(Date())")
        parts.append("App URL: \(consoleURL.absoluteString)")
        parts.append("Project root: \(projectRoot)")

        if let label = statusLabel {
            parts.append("\n--- Status ---")
            parts.append(label.stringValue)
        }

        let logPaths = [
            ("Wrapper log", wrapperLog),
            ("Console log", consoleLog),
        ]
        for (name, path) in logPaths {
            if let content = try? String(contentsOfFile: path, encoding: .utf8) {
                let lines = content.components(separatedBy: "\n")
                let tail = lines.suffix(60).joined(separator: "\n")
                parts.append("\n--- \(name) (last 60 lines) ---")
                parts.append(tail)
            } else {
                parts.append("\n--- \(name) ---")
                parts.append("(not found at \(path))")
            }
        }

        let report = parts.joined(separator: "\n")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(report, forType: .string)

        let alert = NSAlert()
        alert.messageText = "Error report copied"
        alert.informativeText = "The last 60 lines of each log plus current status have been copied to the clipboard. Paste it into the chat to report the issue."
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    // MARK: - Menu bar

    private func buildMenu() {
        let mainMenu = NSMenu()

        // App menu
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "About Image_Gen", action: #selector(showAbout), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Hide Image_Gen", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Quit Image_Gen", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // File menu
        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(NSMenuItem(title: "Open Logs", action: #selector(openLogs), keyEquivalent: "l"))
        fileMenu.addItem(NSMenuItem(title: "Open in Browser", action: #selector(openInBrowser), keyEquivalent: "b"))
        fileMenu.addItem(.separator())
        fileMenu.addItem(NSMenuItem(title: "Close Window", action: #selector(closeWindow), keyEquivalent: "w"))
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        // Edit menu — standard selectors let WebKit/responder chain handle them
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
        let redo = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(customPaste(_:)), keyEquivalent: "v"))
        editMenu.addItem(.separator())
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        // View menu
        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(NSMenuItem(title: "Reload", action: #selector(reloadPage), keyEquivalent: "r"))
        viewMenu.addItem(.separator())
        viewMenu.addItem(NSMenuItem(title: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+"))
        viewMenu.addItem(NSMenuItem(title: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-"))
        viewMenu.addItem(NSMenuItem(title: "Actual Size", action: #selector(actualSize), keyEquivalent: "0"))
        viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        // Window menu
        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m"))
        let zoom = NSMenuItem(title: "Zoom", action: #selector(NSWindow.zoom(_:)), keyEquivalent: "")
        windowMenu.addItem(zoom)
        windowMenu.addItem(.separator())
        windowMenu.addItem(NSMenuItem(title: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: ""))
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu
        mainMenu.addItem(windowItem)

        // Help menu
        let helpItem = NSMenuItem()
        let helpMenu = NSMenu(title: "Help")
        helpMenu.addItem(NSMenuItem(title: "Copy Error Report", action: #selector(copyErrorReport), keyEquivalent: "e"))
        helpMenu.addItem(.separator())
        helpMenu.addItem(NSMenuItem(title: "Open Logs", action: #selector(openLogs), keyEquivalent: ""))
        helpMenu.addItem(NSMenuItem(title: "Open in Browser", action: #selector(openInBrowser), keyEquivalent: ""))
        helpItem.submenu = helpMenu
        NSApp.helpMenu = helpMenu
        mainMenu.addItem(helpItem)

        NSApp.mainMenu = mainMenu
    }

    // MARK: - Window

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
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Service startup

    private func ensureServicesThenLoad() {
        setStatus("Checking local console and BigMac tunnel...")
        DispatchQueue.global(qos: .userInitiated).async {
            self.ensureOperatorConsole()
            self.ensureSdcppTunnel()
            DispatchQueue.main.async {
                self.showMainWindow()
                self.setStatus("Loading Image_Gen at \(self.consoleURL.absoluteString)")
                self.webView.load(URLRequest(url: self.consoleURL))
            }
        }
    }

    private func ensureOperatorConsole() {
        let version = currentConsoleVersion()
        if version.matchesExpectedRoot {
            appendLog("operator-console already listening on \(serverBaseURL.absoluteString) from \(version.cwd ?? "unknown") gitHead=\(version.gitHead ?? "unknown")")
            return
        }
        if version.reachable {
            appendLog("operator-console listener is not this checkout. cwd=\(version.cwd ?? "unknown") pid=\(version.pid.map(String.init) ?? "unknown"). Not reusing stale listener.")
            DispatchQueue.main.async { self.setStatus("Port 31337 is occupied by a different Image_Gen console. Stop it, then relaunch Image_Gen.") }
            return
        }

        let launchEnv = operatorConsoleEnvironment()
        let nodeExecutable = resolveNodeExecutable(pathValue: launchEnv["PATH"] ?? wrapperLaunchPath)
        appendLog("starting operator-console node server with node=\(nodeExecutable) cwd=\(operatorRoot) PATH=\(launchEnv["PATH"] ?? "unset")")
        let process = Process()
        process.currentDirectoryURL = URL(fileURLWithPath: operatorRoot)
        process.environment = launchEnv
        process.executableURL = URL(fileURLWithPath: nodeExecutable)
        process.arguments = nodeExecutable == "/usr/bin/env" ? ["node", "server.js"] : ["server.js"]
        let logHandle = createLogHandle(consoleLog)
        logHandle.seekToEndOfFile()
        process.standardOutput = logHandle
        process.standardError = logHandle
        do {
            try process.run()
            consoleProcess = process
        } catch {
            appendLog("failed to start operator-console: \(error.localizedDescription)")
            DispatchQueue.main.async { self.setStatus("Could not start local console. Use Help → Copy Error Report to share details.") }
            return
        }

        for _ in 0..<30 {
            let startedVersion = currentConsoleVersion()
            if startedVersion.matchesExpectedRoot {
                appendLog("operator-console started from \(startedVersion.cwd ?? "unknown") gitHead=\(startedVersion.gitHead ?? "unknown") pid=\(startedVersion.pid.map(String.init) ?? "unknown")")
                return
            }
            if startedVersion.reachable {
                appendLog("operator-console responded from unexpected checkout while starting. cwd=\(startedVersion.cwd ?? "unknown") pid=\(startedVersion.pid.map(String.init) ?? "unknown")")
                break
            }
            if !process.isRunning {
                appendLog("operator-console process exited before readiness. status=\(process.terminationStatus)")
                break
            }
            Thread.sleep(forTimeInterval: 1)
        }
        appendLog("operator-console did not answer within timeout")
        DispatchQueue.main.async { self.setStatus("Local console did not answer within timeout. Use Help → Copy Error Report to share details.") }
    }

    private func operatorConsoleEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let inheritedPath = env["PATH"] ?? ""
        let merged = (wrapperLaunchPath + ":" + inheritedPath)
            .split(separator: ":")
            .map(String.init)
            .reduce(into: [String]()) { paths, path in
                if !path.isEmpty && !paths.contains(path) {
                    paths.append(path)
                }
            }
            .joined(separator: ":")
        env["PATH"] = merged
        return env
    }

    private func resolveNodeExecutable(pathValue: String) -> String {
        let manager = FileManager.default
        for dir in pathValue.split(separator: ":").map(String.init) {
            let candidate = "\(dir)/node"
            if manager.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return "/usr/bin/env"
    }

    private func currentConsoleVersion() -> (reachable: Bool, matchesExpectedRoot: Bool, cwd: String?, gitHead: String?, pid: Int?) {
        let result = runShell("curl -fsS --max-time 2 \(serverBaseURL.absoluteString)/api/version", timeout: 4)
        guard result.code == 0, let data = result.output.data(using: .utf8) else {
            return (false, false, nil, nil, nil)
        }
        guard
            let object = try? JSONSerialization.jsonObject(with: data),
            let dict = object as? [String: Any]
        else {
            return (true, false, nil, nil, nil)
        }
        let cwd = dict["cwd"] as? String
        let gitHead = dict["gitHead"] as? String
        let pid = dict["pid"] as? Int
        return (true, cwd == expectedConsoleCwd, cwd, gitHead, pid)
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
        if commandOK("lsof -nP -iTCP:17870 -sTCP:LISTEN >/dev/null && curl -fsS --max-time 5 http://127.0.0.1:17870/v1/models >/dev/null", timeout: 8) {
            appendLog("status script did not report UP, but local tunnel 127.0.0.1:17870 answered /v1/models; reusing existing tunnel")
            DispatchQueue.main.async { self.setStatus("BigMac tunnel answered locally.") }
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
                self.setStatus("BigMac server/tunnel is not ready. Use Help → Copy Error Report to share details.")
            }
        }
    }

    // MARK: - Helpers

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
