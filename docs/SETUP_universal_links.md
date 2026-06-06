# Setup — Universal Links (make shared profile links open the app)

This wires the contractor share links / QR codes (`https://renovateconnect.app/b/:id`)
to open the iOS app when it's installed, and the website otherwise.

The code is already in place:
- **Web** serves the association file at `/.well-known/apple-app-site-association`
  (`web/app/api/aasa/route.ts`, via the rewrite in `next.config.mjs`).
- **iOS** parses incoming links (`DeepLink(webURL:)`) and routes them through the
  existing deep-link pipeline (`RenovateConnectApp.handleIncomingURL`,
  consumed by `MainTabView` for signed-in users and `GuestTabView` for guests).
- An entitlements file exists at
  `ios/RenovateConnect/RenovateConnect/RenovateConnect.entitlements`.

What's left is the parts that require a real Apple signing identity (deferred
with the rest of App Store prep — see `LAUNCH_READINESS.md` §3):

## 1. iOS — enable the capability (needs a Dev Team)
1. In Xcode, select the target → **Signing & Capabilities**, set a real Team and
   a valid bundle id (the current `-x4-Solutions.RenovateConnect` is invalid;
   use e.g. `app.renovateconnect`).
2. **+ Capability → Associated Domains**. Confirm the entry
   `applinks:renovateconnect.app` (Xcode will point the target's
   `CODE_SIGN_ENTITLEMENTS` at `RenovateConnect.entitlements`).

## 2. Web — set the appID and deploy
1. Set `IOS_APP_ID` in the web deploy env to `<TeamID>.<BundleID>`
   (e.g. `ABCDE12345.app.renovateconnect`). Find the Team ID in the Apple
   Developer portal (Membership) or Xcode.
2. Deploy `web/` to the domain `renovateconnect.app`.
3. Verify the file is live and valid JSON:
   `curl -i https://renovateconnect.app/.well-known/apple-app-site-association`
   (200, `content-type: application/json`, your appID in `details[0].appID`).

## 3. Verify end-to-end
- Install the app on a device, then tap a `https://renovateconnect.app/b/<id>`
  link from Notes/Messages — it should open the app to that contractor.
- Apple caches the AASA at install time; if it doesn't work, reinstall the app
  after the file is live. Use the **AASA Validator** or
  `swcutil dl -d renovateconnect.app` on macOS to debug.

## Notes
- Until step 1+2 are done, the links still work as **web pages** (the SSR
  profile), so the QR feature is already useful — universal-link app-opening is
  the enhancement on top.
- The same Associated Domains setup will carry `/estimate` deep links when the
  estimator front door ships (build A, Phase 2).
