import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var email = ""
    @State private var password = ""
    @State private var showRegister = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                Text("RenovateConnect")
                    .font(.largeTitle.bold())
                Text("Find trusted renovation contractors")
                    .foregroundStyle(.secondary)

                VStack(spacing: 12) {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                        .textFieldStyle(.roundedBorder)
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .textFieldStyle(.roundedBorder)
                }

                if let error = auth.error {
                    Text(error).foregroundStyle(.red).font(.caption)
                }

                Button {
                    Task { await auth.login(email: email, password: password) }
                } label: {
                    if auth.isLoading {
                        ProgressView()
                    } else {
                        Text("Sign in").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(auth.isLoading || email.isEmpty || password.isEmpty)

                Button("Create an account") { showRegister = true }
                    .font(.footnote)

                Spacer()
            }
            .padding()
            .sheet(isPresented: $showRegister) { RegisterView() }
        }
    }
}
