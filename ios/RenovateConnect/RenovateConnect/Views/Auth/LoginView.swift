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
            VStack(spacing: 0) {

                // Gradient hero
                ZStack {
                    Theme.gradient.ignoresSafeArea(edges: .top)
                    VStack(spacing: 14) {
                        ZStack {
                            Circle()
                                .fill(.white.opacity(0.15))
                                .frame(width: 90, height: 90)
                            Image(systemName: "house.and.flag.fill")
                                .font(.system(size: 42))
                                .foregroundStyle(.white)
                        }
                        VStack(spacing: 5) {
                            Text("RenovateConnect")
                                .font(.system(size: 28, weight: .bold, design: .rounded))
                                .foregroundStyle(.white)
                            Text("Find trusted renovation contractors")
                                .font(.subheadline)
                                .foregroundStyle(.white.opacity(0.85))
                        }
                    }
                    .padding(.top, 20)
                }
                .frame(height: geo.size.height * 0.40)

                // Form
                ScrollView {
                    VStack(spacing: 20) {
                        VStack(spacing: 12) {
                            InputField(icon: "envelope", placeholder: "Email", text: $email)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .autocapitalization(.none)

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
                                    Text("Sign In").font(.headline)
                                }
                            }
                            .frame(maxWidth: .infinity).frame(height: 52)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.primary)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .disabled(auth.isLoading || email.isEmpty || password.isEmpty)

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
                    }
                    .padding(24)
                }
                .background(Color(.systemBackground))
            }
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
}

// MARK: - Input field

struct InputField: View {
    let icon: String
    let placeholder: String
    @Binding var text: String
    var isSecure = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon).foregroundStyle(Theme.primary).frame(width: 20)
            if isSecure {
                SecureField(placeholder, text: $text)
            } else {
                TextField(placeholder, text: $text)
            }
        }
        .padding(14)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
