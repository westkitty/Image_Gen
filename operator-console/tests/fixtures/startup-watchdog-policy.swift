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
        // A transient stall: probes fail, then the full transfer passes and the overlay reloads Studio.
        var retry = FailureAutoRetryPolicy(maximumAttempts: 3)
        precondition(retry.next(studioVerified: false, probePassed: false) == .probeAgain(attempt: 1))
        precondition(retry.next(studioVerified: false, probePassed: true) == .reload)
        // A page that serves but never initializes stays bounded across reloads.
        precondition(retry.next(studioVerified: false, probePassed: true) == .reload)
        precondition(retry.next(studioVerified: false, probePassed: true) == .stop)
        retry.reset()
        precondition(retry.next(studioVerified: true, probePassed: false) == .stop)
        precondition(retry.attempts == 0)
        print("WATCHDOG_POLICY_PASS")
    }
}
