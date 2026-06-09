import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Upload one verification document. Lets the contractor pick a PDF (file
/// importer) or an image (PhotosPicker), enter the doc number + issuer, and
/// pick an expiration date (required for insurance, optional otherwise).
struct UploadVerificationSheet: View {
    let businessId: String
    let type: VerificationDocType
    let onUploaded: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var fileData: Data?
    @State private var fileMime: String = ""
    @State private var filename: String = ""
    @State private var documentNumber: String = ""
    @State private var issuer: String = ""
    @State private var hasExpiry: Bool = false
    @State private var expiresAt: Date = Calendar.current.date(byAdding: .year, value: 1, to: Date()) ?? Date()
    @State private var showFileImporter = false
    @State private var photoPick: PhotosPickerItem?
    @State private var isUploading = false
    @State private var errorMessage: String?

    private var requiresExpiry: Bool { type == .insurance }

    private var canSubmit: Bool {
        fileData != nil && !isUploading && (!requiresExpiry || hasExpiry)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button {
                        showFileImporter = true
                    } label: {
                        Label("Choose a PDF", systemImage: "doc.fill")
                    }
                    PhotosPicker(selection: $photoPick, matching: .images) {
                        Label("Choose a photo", systemImage: "photo.on.rectangle")
                    }
                    if fileData != nil {
                        HStack {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
                            Text(filename.isEmpty ? "File selected" : filename).font(.caption)
                            Spacer()
                            Button("Clear") {
                                fileData = nil; fileMime = ""; filename = ""
                            }
                            .font(.caption)
                        }
                    }
                } header: {
                    Text(type.title)
                } footer: {
                    Text(type.helperCopy)
                }

                Section {
                    TextField(type == .license ? "License number" : (type == .insurance ? "Policy number" : "ID number"),
                              text: $documentNumber)
                    TextField(type == .license ? "Issuing authority (e.g. California CSLB)"
                              : (type == .insurance ? "Insurance carrier (e.g. GEICO)"
                                 : "Issuing authority"),
                              text: $issuer)
                } header: {
                    Text("Details")
                }

                Section {
                    Toggle("Has an expiration date", isOn: $hasExpiry)
                    if hasExpiry {
                        DatePicker("Expires", selection: $expiresAt,
                                   in: Date()...,
                                   displayedComponents: .date)
                    }
                } header: {
                    Text("Expiry")
                } footer: {
                    Text(requiresExpiry
                         ? "Insurance certificates must include an expiration date."
                         : "Some licenses don't expire — leave this off if so.")
                }

                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red).font(.caption) }
                }
            }
            .navigationTitle("Upload")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") { Task { await submit() } }
                        .disabled(!canSubmit)
                }
            }
            .fileImporter(isPresented: $showFileImporter,
                          allowedContentTypes: [.pdf]) { result in
                handlePicked(result)
            }
            .onChange(of: photoPick) { _, newValue in
                Task { await loadPhoto(newValue) }
            }
            .onAppear {
                // Default insurance to "has expiry on" so the user can't forget.
                if requiresExpiry { hasExpiry = true }
            }
        }
    }

    private func handlePicked(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            // The URL is a security-scoped file we need to access briefly.
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            do {
                fileData = try Data(contentsOf: url)
                fileMime = "application/pdf"
                filename = url.lastPathComponent
            } catch {
                errorMessage = "Couldn't read file: \(error.localizedDescription)"
            }
        case .failure(let error):
            errorMessage = error.localizedDescription
        }
    }

    private func loadPhoto(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        do {
            if let data = try await item.loadTransferable(type: Data.self) {
                fileData = data
                fileMime = "image/jpeg" // PhotosPicker hands us HEIC/JPEG; server accepts both
                filename = "photo.jpg"
            }
        } catch {
            errorMessage = "Couldn't load photo: \(error.localizedDescription)"
        }
    }

    private func submit() async {
        guard let fileData else { return }
        isUploading = true
        errorMessage = nil
        do {
            let expiryISO: String?
            if hasExpiry {
                let f = ISO8601DateFormatter()
                f.formatOptions = [.withInternetDateTime]
                expiryISO = f.string(from: expiresAt)
            } else {
                expiryISO = nil
            }
            _ = try await APIService.shared.uploadVerificationDocument(
                businessId: businessId,
                fileData: fileData,
                mimeType: fileMime,
                filename: filename.isEmpty ? "file" : filename,
                type: type,
                documentNumber: documentNumber,
                issuer: issuer,
                expiresAt: expiryISO
            )
            onUploaded()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isUploading = false
    }
}
