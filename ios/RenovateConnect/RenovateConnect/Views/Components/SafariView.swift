import SwiftUI
import SafariServices

/// Presents a URL in an in-app Safari view. Used for Stripe Checkout / Connect
/// onboarding so we never handle card data ourselves — Stripe collects it and
/// our webhook records the result, after which the caller refreshes its data on
/// dismiss.
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

// Allow `URL` to drive a SwiftUI `.sheet(item:)`.
extension URL: Identifiable {
    public var id: String { absoluteString }
}
