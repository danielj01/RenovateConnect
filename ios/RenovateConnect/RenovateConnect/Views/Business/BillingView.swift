import SwiftUI
import SafariServices

// MARK: - Billing & promotion

/// The business's money hub: shows the saved card and this month's accrued lead
/// fees, lets them add/update a card, and start or cancel the promoted listing.
/// Payment capture happens in Stripe-hosted Checkout (opened in a Safari sheet);
/// the server is updated by webhook, so we just refresh the summary on return.
struct BillingView: View {
    @State private var summary: BillingSummary?
    @State private var connect: ConnectStatus?
    @State private var isLoading = true
    @State private var error: String?
    @State private var checkoutURL: URL?
    @State private var actionInFlight = false

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                if isLoading && connect == nil {
                    ProgressView().padding(.top, 60)
                } else {
                    payoutCard(connect)
                    if let error {
                        Text(error).font(.caption).foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Billing")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        // Reload after the hosted Checkout sheet closes — by then the webhook
        // has (usually) recorded the card/subscription server-side.
        .sheet(item: $checkoutURL, onDismiss: { Task { await load() } }) { url in
            SafariView(url: url).ignoresSafeArea()
        }
    }

    // MARK: Cards

    private func payoutCard(_ c: ConnectStatus?) -> some View {
        let active = c?.payoutsEnabled ?? false
        return RCCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Image(systemName: active ? "checkmark.seal.fill" : "banknote")
                        .font(.title2)
                        .foregroundStyle(active ? Theme.success : Theme.primary)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(active ? "Payouts active" : "Get paid in-app")
                            .font(.headline)
                        Text(active
                             ? "Homeowners can pay a deposit when they accept your quote, paid out to your bank."
                             : "Set up payouts so homeowners can pay a deposit the moment they accept your quote.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                if !active {
                    Button {
                        Task { await startConnectOnboarding() }
                    } label: {
                        Label(c?.onboarded == true ? "Finish payout setup" : "Set up payouts",
                              systemImage: "building.columns")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.primary)
                    .disabled(actionInFlight)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func promotionCard(_ s: BillingSummary) -> some View {
        RCCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Image(systemName: s.isPromoted ? "bolt.fill" : "bolt.slash.fill")
                        .font(.title2)
                        .foregroundStyle(s.isPromoted ? Theme.gold : .secondary)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(s.isPromoted ? "Promoted listing active" : "Get promoted")
                            .font(.headline)
                        Text(s.isPromoted
                             ? "You appear at the top of search results."
                             : "Appear first in search results and win more leads.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }

                if s.isPromoted {
                    if let until = s.promotedUntil {
                        Text("Renews \(Self.shortDate(until))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Button(role: .destructive) {
                        Task { await cancelPromotion() }
                    } label: {
                        Text("Cancel promotion").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(actionInFlight)
                } else {
                    Button {
                        Task { await startCheckout(.promote) }
                    } label: {
                        Label("Promote for $99/mo", systemImage: "wand.and.stars")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.primary)
                    .disabled(actionInFlight)
                }
            }
            .padding(18)
        }
    }

    private func paymentMethodCard(_ s: BillingSummary) -> some View {
        RCCard {
            VStack(alignment: .leading, spacing: 14) {
                Text("Payment method").font(.headline)
                if let card = s.card {
                    HStack(spacing: 12) {
                        Image(systemName: "creditcard.fill").foregroundStyle(Theme.primary)
                        Text("\(card.brand.capitalized) •••• \(card.last4)")
                            .font(.subheadline.weight(.medium))
                        Spacer()
                    }
                    Button("Update card") { Task { await startCheckout(.setup) } }
                        .font(.subheadline)
                        .disabled(actionInFlight)
                } else {
                    Text("Add a card so monthly lead fees can be charged automatically.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button {
                        Task { await startCheckout(.setup) }
                    } label: {
                        Label("Add a card", systemImage: "creditcard")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.primary)
                    .disabled(actionInFlight)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func leadFeesCard(_ s: BillingSummary) -> some View {
        RCCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("This month's lead fees").font(.headline)
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(s.unbilledLeads) lead\(s.unbilledLeads == 1 ? "" : "s")")
                            .font(.subheadline.weight(.medium))
                        Text("Billed at \(Self.money(s.leadFeeCents)) each, end of month.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(Self.money(s.unbilledAmountCents))
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(Theme.primary)
                }
                if !s.hasPaymentMethod && s.unbilledLeads > 0 {
                    Label("Add a card to keep getting leads.", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption).foregroundStyle(.orange)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var footnote: some View {
        Text("Lead fees are totaled into one invoice at the end of each month and charged to your card on file. Promoted listings renew monthly until cancelled.")
            .font(.caption2).foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 8)
    }

    // MARK: Actions

    private enum CheckoutKind { case setup, promote }

    private func startCheckout(_ kind: CheckoutKind) async {
        actionInFlight = true
        error = nil
        defer { actionInFlight = false }
        do {
            switch kind {
            case .setup:   checkoutURL = try await APIService.shared.billingSetupCardURL()
            case .promote: checkoutURL = try await APIService.shared.promotedCheckoutURL()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func startConnectOnboarding() async {
        actionInFlight = true
        error = nil
        defer { actionInFlight = false }
        do {
            checkoutURL = try await APIService.shared.connectOnboardURL()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func cancelPromotion() async {
        actionInFlight = true
        defer { actionInFlight = false }
        do {
            try await APIService.shared.cancelPromoted()
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func load() async {
        error = nil
        if connect == nil { isLoading = true }
        defer { isLoading = false }
        do {
            connect = try await APIService.shared.connectStatus()
            // Legacy billing summary is no longer surfaced in the UI; keep it
            // non-fatal so a payout-only screen still renders.
            summary = try? await APIService.shared.billingSummary()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: Formatting

    private static func money(_ cents: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        // Drop cents when it's a whole dollar amount for a cleaner look.
        f.maximumFractionDigits = cents % 100 == 0 ? 0 : 2
        return f.string(from: NSNumber(value: Double(cents) / 100.0)) ?? "$\(cents / 100)"
    }

    private static func shortDate(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return "soon" }
        let out = DateFormatter()
        out.dateStyle = .medium
        return out.string(from: date)
    }
}

// MARK: - Safari wrapper for Stripe-hosted Checkout

/// Presents a URL in an in-app Safari view. Used for Stripe Checkout so we never
/// handle card data ourselves — Stripe collects it and our webhook records the
/// result, after which the caller refreshes its data on dismiss.
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
