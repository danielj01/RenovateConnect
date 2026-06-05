import SwiftUI
import CoreImage.CIFilterBuiltins
import UIKit

/// Lets a contractor share their public profile link + QR code. This turns every
/// contractor into a distribution channel: they post the link/QR on their site,
/// Instagram, truck, business cards, and invoices, sending their own customers
/// into the app (the cheapest demand loop for a marketplace).
struct ShareProfileView: View {
    let business: Business
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    private var shareURL: URL { business.shareLink }

    private var shareMessage: String {
        "Check out \(business.companyName) on RenovateConnect — see my work, reviews, and get an instant estimate: \(shareURL.absoluteString)"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    qrCard
                    linkRow
                    actions
                    tip
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Share your profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    // MARK: - Sections

    private var qrCard: some View {
        VStack(spacing: 14) {
            if let qr = Self.qrImage(from: shareURL.absoluteString) {
                Image(uiImage: qr)
                    .interpolation(.none) // keep QR crisp, not blurred
                    .resizable()
                    .scaledToFit()
                    .frame(width: 220, height: 220)
                    .padding(12)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 16))
            }
            Text(business.companyName)
                .font(.headline)
            Text("Scan to view profile")
                .font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .background(Theme.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 20))
    }

    private var linkRow: some View {
        HStack {
            Text(shareURL.absoluteString)
                .font(.subheadline)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
            Button {
                UIPasteboard.general.string = shareURL.absoluteString
                withAnimation { copied = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                    withAnimation { copied = false }
                }
            } label: {
                Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                    .font(.subheadline.weight(.semibold))
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private var actions: some View {
        ShareLink(item: shareURL, message: Text(shareMessage)) {
            Label("Share link", systemImage: "square.and.arrow.up")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .foregroundStyle(.white)
                .background(Theme.primary, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private var tip: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lightbulb.fill").foregroundStyle(.orange)
            Text("Add this link to your website, Instagram bio, and business cards. Print the QR code for your truck or job-site sign so customers can reach you in one tap.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - QR generation (on-device, no network)

    private static let ciContext = CIContext()

    static func qrImage(from string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        // Scale up so the small generated image renders sharp at display size.
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let cg = ciContext.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
