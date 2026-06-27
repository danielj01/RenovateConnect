import SwiftUI

struct RegisterView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var role: UserRole = .client
    @State private var agreedToTerms = false

    // The marketing site that hosts the legal pages. Compiled in so the links
    // work in both DEBUG and release.
    private static let termsURL = URL(string: "https://renovateconnect.app/terms")!
    private static let privacyURL = URL(string: "https://renovateconnect.app/privacy")!

    private var canSubmit: Bool {
        !auth.isLoading && !name.isEmpty && !email.isEmpty && password.count >= 8 && agreedToTerms
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Your details") {
                    TextField("Full name", text: $name)
                    TextField("Email", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    SecureField("Password (8+ chars)", text: $password)
                }
                Section("I am a…") {
                    Picker("Account type", selection: $role) {
                        Text("Homeowner / Client").tag(UserRole.client)
                        Text("Renovation Business").tag(UserRole.business)
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    // Explicit clickwrap: the account cannot be created until the
                    // user affirmatively agrees, and the agreed-to terms are
                    // recorded server-side (timestamp + version).
                    Toggle(isOn: $agreedToTerms) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("I agree to the Terms & Privacy Policy")
                                .font(.subheadline)
                            HStack(spacing: 12) {
                                Link("Terms of Service", destination: Self.termsURL)
                                Link("Privacy Policy", destination: Self.privacyURL)
                            }
                            .font(.caption)
                        }
                    }
                }
                if let error = auth.error {
                    Section { Text(error).foregroundStyle(.red).font(.caption) }
                }
            }
            .navigationTitle("Create account")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Register") {
                        Task {
                            await auth.register(email: email, password: password, name: name,
                                                role: role, acceptedTerms: agreedToTerms)
                        }
                    }
                    .disabled(!canSubmit)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
