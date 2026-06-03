import SwiftUI
import Combine
import AuthenticationServices

// MARK: - Apple Sign In handler
// NSObject subclass with explicit objectWillChange — avoids synthesis issues

final class AppleSignInHandler: NSObject, ObservableObject,
    ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding
{
    let objectWillChange = PassthroughSubject<Void, Never>()

    var onSuccess: ((String, String?, String?, String?) -> Void)?
    var onError:   ((String) -> Void)?

    func start() {
        let provider = ASAuthorizationAppleIDProvider()
        let request  = provider.createRequest()
        request.requestedScopes = [.fullName, .email]
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate                    = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let cred      = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken,
              let token     = String(data: tokenData, encoding: .utf8) else { return }
        let givenName  = cred.fullName?.givenName
        let familyName = cred.fullName?.familyName
        let email      = cred.email
        DispatchQueue.main.async { self.onSuccess?(token, givenName, familyName, email) }
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithError error: Error) {
        let code = (error as NSError).code
        // 1001 = user cancelled, 1000 = entitlement not yet active on Apple's servers
        guard code != 1001, code != 1000 else { return }
        DispatchQueue.main.async { self.onError?(error.localizedDescription) }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
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

// MARK: - Login view

struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var appleHandler = AppleSignInHandler()

    @State private var email        = ""
    @State private var password     = ""
    @State private var showRegister = false

    var body: some View {
        GeometryReader { geo in
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    hero(height: max(300, geo.size.height * 0.44))
                    // Pull the rounded form card up so it overlaps the hero for
                    // a layered, modern depth effect.
                    formCard
                        .padding(.top, -28)
                }
            }
            .background(Color(.systemBackground))
        }
        .ignoresSafeArea(edges: .top)
        .onAppear {
            appleHandler.onSuccess = { token, given, family, email in
                Task {
                    await auth.signInWithApple(
                        identityToken: token,
                        givenName: given,
                        familyName: family,
                        email: email
                    )
                }
            }
            appleHandler.onError = { msg in auth.error = msg }
        }
        .sheet(isPresented: $showRegister) {
            RegisterView().environmentObject(auth)
        }
    }

    // MARK: - Hero

    private func hero(height: CGFloat) -> some View {
        ZStack {
            Theme.gradient

            // Soft layered shapes add depth without a heavy background image.
            Circle().fill(.white.opacity(0.10))
                .frame(width: 240, height: 240).offset(x: -130, y: -70)
            Circle().fill(.white.opacity(0.07))
                .frame(width: 170, height: 170).offset(x: 140, y: 40)
            Circle().stroke(.white.opacity(0.18), lineWidth: 1.5)
                .frame(width: 130, height: 130).offset(x: 120, y: -90)

            VStack(spacing: 18) {
                BrandLogo(size: 86)
                VStack(spacing: 6) {
                    Text("RenovateConnect")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("Find trusted renovation contractors")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.9))
                }
            }
            // Lift content clear of the overlapping form card below.
            .padding(.bottom, 24)
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    // MARK: - Form card

    private var formCard: some View {
        VStack(spacing: 20) {
            VStack(spacing: 4) {
                Text("Welcome back")
                    .font(.title2.bold())
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("Sign in to pick up where you left off")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            VStack(spacing: 12) {
                InputField(icon: "envelope", placeholder: "Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                InputField(icon: "lock", placeholder: "Password", text: $password, isSecure: true)
                    .textContentType(.password)
            }

            if let error = auth.error {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
                    Text(error).font(.caption).foregroundStyle(.red)
                    Spacer()
                }
            }

            Button {
                Task { await auth.login(email: email, password: password) }
            } label: {
                Group {
                    if auth.isLoading {
                        ProgressView().tint(.white)
                    } else {
                        Text("Sign In").font(.headline).foregroundStyle(.white)
                    }
                }
                .frame(maxWidth: .infinity).frame(height: 52)
                .background(Theme.gradient)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .shadow(color: Theme.primary.opacity(0.35), radius: 10, y: 5)
            }
            .buttonStyle(.plain)
            .opacity(canSubmit ? 1 : 0.55)
            .disabled(!canSubmit)

            HStack {
                Rectangle().frame(height: 1).foregroundStyle(Color(.systemGray4))
                Text("or").font(.caption).foregroundStyle(.secondary).fixedSize()
                Rectangle().frame(height: 1).foregroundStyle(Color(.systemGray4))
            }

            Button { appleHandler.start() } label: {
                HStack(spacing: 8) {
                    Image(systemName: "applelogo").font(.system(size: 17, weight: .medium))
                    Text("Sign in with Apple").font(.system(size: 17, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity).frame(height: 52)
                .background(.black)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }

            Button {
                showRegister = true
            } label: {
                Text("Don't have an account? ").foregroundStyle(.secondary)
                + Text("Create one").foregroundStyle(Theme.primary).bold()
            }
            .font(.subheadline)
            .padding(.top, 2)
        }
        .padding(24)
        .padding(.top, 8)
        .frame(maxWidth: .infinity)
        .background(Color(.systemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: Theme.cardShadow, radius: 20, y: -4)
    }

    private var canSubmit: Bool {
        !auth.isLoading && !email.isEmpty && !password.isEmpty
    }
}

// MARK: - Input field

struct InputField: View {
    let icon: String
    let placeholder: String
    @Binding var text: String
    var isSecure = false

    @State private var reveal = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(focused ? Theme.primary : .secondary)
                .frame(width: 20)

            if isSecure && !reveal {
                SecureField(placeholder, text: $text).focused($focused)
            } else {
                TextField(placeholder, text: $text).focused($focused)
            }

            // Password visibility toggle — one of the most-missed login affordances.
            if isSecure {
                Button { reveal.toggle() } label: {
                    Image(systemName: reveal ? "eye.slash.fill" : "eye.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(reveal ? "Hide password" : "Show password")
            }
        }
        .padding(14)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(focused ? Theme.primary.opacity(0.6) : Color(.systemGray5), lineWidth: 1)
        )
        .animation(.easeInOut(duration: 0.15), value: focused)
    }
}
