import SwiftUI

struct RegisterView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var role: UserRole = .client

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
                if let error = auth.error {
                    Section { Text(error).foregroundStyle(.red).font(.caption) }
                }
            }
            .navigationTitle("Create account")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Register") {
                        Task { await auth.register(email: email, password: password, name: name, role: role) }
                    }
                    .disabled(auth.isLoading || name.isEmpty || email.isEmpty || password.count < 8)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
