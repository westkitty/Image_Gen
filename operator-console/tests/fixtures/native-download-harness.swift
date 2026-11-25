
// Appended to the real ImageGenApp.swift by native-download.test.js in place of its main block, so the shipped
// navigation and download delegate runs unchanged. Off screen: no window, no Dock tile, scratch Downloads folder.
extension AppDelegate {
    func harnessAttach() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
        view.navigationDelegate = self
        view.uiDelegate = self
        webView = view
        statusLabel = NSTextField(labelWithString: "")
        return view
    }
    func harnessCancel() { cancelDownloads() }
    // What closing the window does to the status line.
    func harnessCloseWindow() { statusLabel = nil }
    var harnessStatus: String { statusLabel?.stringValue ?? "" }
    var harnessURL: URL { consoleURL }
}

@MainActor func harnessRun() async {
    let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    guard let root = ProcessInfo.processInfo.environment["DEX_HARNESS_HOME"], downloads.resolvingSymlinksInPath().path == URL(fileURLWithPath: root + "/Downloads").resolvingSymlinksInPath().path else {
        print("UNSAFE downloads directory is not the scratch one"); exit(2)
    }
    let delegate = AppDelegate()
    let view = delegate.harnessAttach()
    func js(_ code: String) async -> Any? { try? await view.evaluateJavaScript(code) }
    func pause(_ ms: UInt64) async { try? await Task.sleep(nanoseconds: ms * 1_000_000) }
    func files() -> [String] { ((try? FileManager.default.contentsOfDirectory(atPath: downloads.path)) ?? []).sorted() }
    func load() async {
        view.load(URLRequest(url: delegate.harnessURL))
        for _ in 0..<100 { await pause(50); if await js("window.__ready===true") as? Bool == true { break } }
        _ = await js("window.__mark='kept'; 1")
    }
    await load()
    let steps = (try? JSONSerialization.jsonObject(with: Data(ProcessInfo.processInfo.environment["DEX_HARNESS_STEPS"]!.utf8))) as? [[String: String]] ?? []
    for step in steps {
        let before = Set(files())
        _ = await js(step["js"]! + ";1")
        if step["cancel"] == "1" { await pause(600); delegate.harnessCancel() }
        if step["close"] == "1" { delegate.harnessCloseWindow() }
        // Long enough for a download to finish or a page to be replaced; a kept page stays kept.
        await pause(UInt64(step["wait"] ?? "1200")!)
        let kept = await js("window.__mark==='kept'") as? Bool ?? false
        let row: [String: Any] = ["name": step["name"]!, "kept": kept, "path": view.url?.path ?? "", "query": view.url?.query ?? "",
                                  "added": Array(Set(files()).subtracting(before)).sorted(), "status": delegate.harnessStatus]
        print(String(data: try! JSONSerialization.data(withJSONObject: row), encoding: .utf8)!)
        if !kept { await load() }
    }
    exit(0)
}

let harnessApp = NSApplication.shared
harnessApp.setActivationPolicy(.prohibited)
Task { @MainActor in await harnessRun() }
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { print("TIMEOUT"); exit(3) }
harnessApp.run()
