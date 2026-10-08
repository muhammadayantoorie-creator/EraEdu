# Browser proctoring signals

EraEdu records only signals observable to the exam page: a document becoming
hidden or visible, window focus changes, an in-page fullscreen exit, supported
Document Picture-in-Picture entry, and optional camera-model results.

These signals are review evidence, not proof of a particular application,
screen-sharing session, recording session, or intent. In particular, the web
platform's `getDisplayMedia()` asks the *calling page's user* to choose a
surface for that page to capture; it cannot enumerate or inspect another
application's active Google Meet, operating-system, or browser capture session.

If a student externally shares a screen while the exam page stays focused and
visible, EraEdu has no reliable browser-only signal for it. This case is
unsupported and must not be described as detected.

A firm requirement to detect external sharing would require an explicit,
consent-based architecture outside this website: for example a managed-browser
extension with narrowly scoped permissions, a managed-device/native agent, or
institutional endpoint-management telemetry. Each option needs separate privacy,
security, deployment, and policy review; none is enabled by EraEdu today.
