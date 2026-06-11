import Foundation
import Combine
import AuthenticationServices
import CryptoKit

/// Sign in with Google via the system web auth session — no Google SDK.
/// Runs the standard OAuth authorization-code flow with PKCE against Google's
/// endpoints and hands the resulting ID token to the caller, which posts it to
/// our `/auth/google` endpoint for verification (mirrors `AppleSignInHandler`).
///
/// Setup: create an **iOS** OAuth client in Google Cloud Console
/// (APIs & Services → Credentials → Create credentials → OAuth client ID,
/// bundle id `app.renovateconnect`), paste it below, and add the same id to the
/// server's `GOOGLE_CLIENT_IDS`. iOS clients use no secret; the redirect is the
/// reversed-client-id scheme, which `ASWebAuthenticationSession` intercepts
/// directly (no Info.plist URL-scheme registration needed).
final class GoogleSignInHandler: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    // NSObject subclass with explicit objectWillChange — same synthesis
    // workaround as AppleSignInHandler.
    let objectWillChange = PassthroughSubject<Void, Never>()

    /// The iOS OAuth client id from Google Cloud Console.
    static let clientID = "YOUR_IOS_CLIENT_ID.apps.googleusercontent.com"

    var onSuccess: ((String) -> Void)?   // verified Google ID token (JWT)
    var onError: ((String) -> Void)?

    private var session: ASWebAuthenticationSession?

    var isConfigured: Bool { !Self.clientID.hasPrefix("YOUR_") }

    func start() {
        guard isConfigured else {
            onError?("Google Sign-In isn't configured yet.")
            return
        }

        // PKCE: the token exchange must present the verifier matching the
        // challenge we send now, so an intercepted redirect alone is useless.
        let verifier = Self.randomURLSafeString(bytes: 64)
        let challenge = Self.sha256Base64URL(verifier)

        // e.g. "1234-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.1234-abc"
        let scheme = Self.clientID.split(separator: ".").reversed().joined(separator: ".")
        let redirectURI = "\(scheme):/oauth2redirect"

        var auth = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        auth.queryItems = [
            .init(name: "client_id", value: Self.clientID),
            .init(name: "redirect_uri", value: redirectURI),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: "openid email profile"),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
        ]

        let session = ASWebAuthenticationSession(url: auth.url!, callbackURLScheme: scheme) { [weak self] callbackURL, error in
            guard let self else { return }
            if let error {
                // Cancelled by the user — stay quiet, like the Apple handler.
                if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue { return }
                DispatchQueue.main.async { self.onError?(error.localizedDescription) }
                return
            }
            guard let callbackURL,
                  let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
                      .queryItems?.first(where: { $0.name == "code" })?.value else {
                DispatchQueue.main.async { self.onError?("Google sign-in didn't return a code.") }
                return
            }
            Task { await self.exchangeCode(code, verifier: verifier, redirectURI: redirectURI) }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false // keep Google session for one-tap next time
        self.session = session
        session.start()
    }

    /// Swap the authorization code for tokens directly with Google (iOS OAuth
    /// clients are public — no client secret involved) and surface the ID token.
    private func exchangeCode(_ code: String, verifier: String, redirectURI: String) async {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let form = [
            "client_id": Self.clientID,
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
            "redirect_uri": redirectURI,
        ]
        req.httpBody = form
            .map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? $0.value)" }
            .joined(separator: "&")
            .data(using: .utf8)

        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let idToken = json["id_token"] as? String else {
                await MainActor.run { self.onError?("Google sign-in failed. Please try again.") }
                return
            }
            await MainActor.run { self.onSuccess?(idToken) }
        } catch {
            await MainActor.run { self.onError?("Google sign-in failed. Please check your connection.") }
        }
    }

    // MARK: - PKCE helpers

    private static func randomURLSafeString(bytes count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return Data(bytes).base64URLEncoded()
    }

    private static func sha256Base64URL(_ input: String) -> String {
        Data(SHA256.hash(data: Data(input.utf8))).base64URLEncoded()
    }

    // MARK: - ASWebAuthenticationPresentationContextProviding

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }.first
        return scene?.windows.first { $0.isKeyWindow }
            ?? scene.map { UIWindow(windowScene: $0) }
            ?? UIWindow()
    }
}

private extension Data {
    func base64URLEncoded() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
