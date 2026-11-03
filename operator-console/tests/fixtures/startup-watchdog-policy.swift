@main
struct StartupWatchdogPolicyFixture {
    static func main() {
        var policy = StartupWatchdogPolicy()
        precondition(policy.evaluate(callbackToken: 7, currentToken: 7, webViewIsCurrent: true,
            studioVerified: false, startupIsProgressing: true) == .deferFailure(attempt: 1))
        precondition(policy.evaluate(callbackToken: 7, currentToken: 7, webViewIsCurrent: true,
            studioVerified: false, startupIsProgressing: true) == .deferFailure(attempt: 2))
        precondition(policy.evaluate(callbackToken: 7, currentToken: 7, webViewIsCurrent: true,
            studioVerified: false, startupIsProgressing: true) == .showFailure)
        precondition(policy.evaluate(callbackToken: 6, currentToken: 7, webViewIsCurrent: true,
            studioVerified: false, startupIsProgressing: true) == .ignoreStaleCallback)
        precondition(policy.evaluate(callbackToken: 7, currentToken: 7, webViewIsCurrent: false,
            studioVerified: false, startupIsProgressing: true) == .ignoreStaleCallback)
        precondition(policy.evaluate(callbackToken: 7, currentToken: 7, webViewIsCurrent: true,
            studioVerified: true, startupIsProgressing: false) == .alreadyVerified)
        policy.reset()
        precondition(policy.evaluate(callbackToken: 8, currentToken: 8, webViewIsCurrent: true,
            studioVerified: false, startupIsProgressing: false) == .showFailure)
        print("WATCHDOG_POLICY_PASS")
    }
}
