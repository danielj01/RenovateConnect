import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Contractor-facing center for license + insurance verification. Lists every
/// upload (with admin review status) and lets the contractor add a new one.
/// Surfaced from the contractor dashboard.
struct VerificationCenterView: View {
    let businessId: String

    @State private var docs: [VerificationDocument] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var uploadTarget: VerificationDocType?
    @State private var deleteError: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView().padding(.top, 60)
            } else {
                content
            }
        }
        .navigationTitle("Verification")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $uploadTarget) { type in
            UploadVerificationSheet(businessId: businessId, type: type) {
                Task { await load() }
            }
        }
        .alert("Couldn't delete",
               isPresented: Binding(get: { deleteError != nil },
                                    set: { if !$0 { deleteError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(deleteError ?? "")
        }
    }

    @ViewBuilder
    private var content: some View {
        ScrollView {
            VStack(spacing: 16) {
                summaryCard
                ForEach(VerificationDocType.allCases) { type in
                    typeSection(type)
                }
                explainerFooter
            }
            .padding(16)
        }
    }

    private var summaryCard: some View {
        let licenseOK = docs.contains { $0.type == .license && $0.status == .approved }
        let insuranceOK = docs.contains { $0.type == .insurance && $0.status == .approved }
        let isVerified = licenseOK && insuranceOK
        return RCCard {
            VStack(alignment: .leading, spacing: 10) {
                Label(isVerified ? "You're verified" : "Get verified",
                      systemImage: isVerified ? "checkmark.seal.fill" : "checkmark.shield")
                    .font(.headline)
                    .foregroundStyle(isVerified ? Theme.success : Theme.primary)
                Text(isVerified
                     ? "Your business shows the Verified badge in search and on your profile."
                     : "Upload a current license and certificate of insurance. Once an admin approves both, your profile gets the Verified badge and ranks higher in search.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func typeSection(_ type: VerificationDocType) -> some View {
        let items = docs.filter { $0.type == type }
        RCCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(type.title).font(.subheadline.weight(.semibold))
                        Text(type.helperCopy).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        uploadTarget = type
                    } label: {
                        Label("Upload", systemImage: "plus")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }

                if !items.isEmpty {
                    Divider()
                    ForEach(items) { doc in
                        documentRow(doc)
                    }
                }
            }
            .padding(16)
        }
    }

    @ViewBuilder
    private func documentRow(_ doc: VerificationDocument) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: doc.status.systemImage)
                .foregroundStyle(color(for: doc.status))
                .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(doc.status.label).font(.subheadline.weight(.semibold))
                if let n = doc.documentNumber, !n.isEmpty {
                    Text(n).font(.caption).foregroundStyle(.secondary)
                }
                if let exp = doc.expiresAt {
                    Text("Expires \(shortDate(exp))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if doc.status == .rejected, let reason = doc.rejectionReason {
                    Text(reason)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.top, 2)
                }
            }
            Spacer()
            if doc.status == .pending {
                Button(role: .destructive) {
                    Task { await delete(doc) }
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless)
            }
        }
        .padding(.vertical, 4)
    }

    private var explainerFooter: some View {
        Text("Documents are reviewed by RenovateConnect staff. Approval can take 1–2 business days. You'll get a notification when your status changes.")
            .font(.caption).foregroundStyle(.secondary)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func color(for status: VerificationDocStatus) -> Color {
        switch status {
        case .pending: return .secondary
        case .approved: return Theme.success
        case .rejected: return .red
        }
    }

    private func shortDate(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let d = parsed else { return iso }
        let out = DateFormatter()
        out.dateStyle = .medium
        return out.string(from: d)
    }

    private func load() async {
        isLoading = true
        do {
            docs = try await APIService.shared.verificationDocuments(businessId: businessId)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private func delete(_ doc: VerificationDocument) async {
        do {
            try await APIService.shared.deleteVerificationDocument(businessId: businessId, docId: doc.id)
            docs.removeAll { $0.id == doc.id }
        } catch {
            deleteError = error.localizedDescription
        }
    }
}
