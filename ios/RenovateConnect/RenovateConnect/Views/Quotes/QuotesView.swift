import SwiftUI

/// Role-aware quote-request list. Homeowners track briefs they've sent and
/// accept/withdraw; contractors see incoming briefs and send or decline quotes.
struct QuotesView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var quotes: [QuoteRequest] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var actionError: String?

    private var isBusiness: Bool { auth.currentUser?.role == .business }

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView().padding(.top, 60)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Couldn't load quotes", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Try Again") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.primary)
                }
                .padding(.top, 60)
            } else if quotes.isEmpty {
                ContentUnavailableView {
                    Label("No quote requests", systemImage: "doc.text.magnifyingglass")
                } description: {
                    Text(isBusiness
                         ? "Project briefs from homeowners will appear here."
                         : "Request an estimate from a contractor's profile.")
                }
                .padding(.top, 60)
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(quotes) { quote in
                        QuoteCard(
                            quote: quote,
                            isBusiness: isBusiness,
                            onUpdate: { status, low, high, note in
                                await update(quote, status: status, low: low, high: high, note: note)
                            },
                            onReload: { await load() }
                        )
                        .padding(.horizontal, 16)
                    }
                }
                .padding(.vertical, 12)
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle("Quotes")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .alert("Something went wrong", isPresented: Binding(
            get: { actionError != nil },
            set: { if !$0 { actionError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(actionError ?? "")
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            quotes = try await APIService.shared.myQuotes()
            loadError = nil
        } catch {
            // Only show the error state when we have nothing to fall back on;
            // a failed refresh shouldn't blow away the list already on screen.
            if quotes.isEmpty { loadError = error.localizedDescription }
        }
    }

    private func update(_ quote: QuoteRequest, status: QuoteStatus,
                        low: Int?, high: Int?, note: String?) async {
        do {
            let updated = try await APIService.shared.updateQuote(
                id: quote.id, status: status, quoteLow: low, quoteHigh: high, responseNote: note)
            if let idx = quotes.firstIndex(where: { $0.id == updated.id }) {
                quotes[idx] = updated
            }
        } catch {
            actionError = error.localizedDescription
        }
    }
}

// MARK: - Card

private struct QuoteCard: View {
    let quote: QuoteRequest
    let isBusiness: Bool
    let onUpdate: (QuoteStatus, Int?, Int?, String?) async -> Void
    let onReload: () async -> Void

    @State private var working = false
    @State private var showSendQuote = false
    @State private var depositLoading = false
    @State private var depositError: String?
    @State private var depositURL: URL?

    private var counterpartyName: String {
        isBusiness
            ? (quote.client?.name ?? "Homeowner")
            : (quote.business?.companyName ?? "Contractor")
    }

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label(counterpartyName, systemImage: isBusiness ? "person.fill" : "building.2.fill")
                        .font(.headline)
                        .foregroundStyle(Theme.primary)
                    Spacer()
                    QuoteStatusBadge(status: quote.status)
                }

                if let category = quote.category, !category.isEmpty {
                    Label(category, systemImage: "wrench.and.screwdriver.fill")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                }

                Text(quote.description)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .lineLimit(5)

                if let budget = quote.budgetText {
                    detailRow(icon: "dollarsign.circle", text: "Budget: \(budget)")
                }
                if let timeline = quote.timeline, !timeline.isEmpty {
                    detailRow(icon: "calendar", text: timeline)
                }

                // The contractor's quote, once provided.
                if let quoteText = quote.quoteText {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("Estimate: \(quoteText)", systemImage: "dollarsign.circle.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.primary)
                        if let note = quote.responseNote, !note.isEmpty {
                            Text(note).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                }

                if !actions.isEmpty {
                    Divider()
                    HStack(spacing: 10) {
                        ForEach(actions) { action in
                            Button {
                                handle(action)
                            } label: {
                                Text(action.label)
                                    .font(.subheadline.weight(.semibold))
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 38)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(action.tint)
                            .disabled(working)
                        }
                    }
                }

                // Homeowner deposit — once a quote is accepted, paying the
                // deposit in-app confirms the job and keeps it on-platform.
                if !isBusiness, quote.status == .accepted {
                    if quote.depositPaid {
                        Divider()
                        Label("Deposit paid", systemImage: "checkmark.seal.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.success)
                    } else if quote.business?.payoutsEnabled == true {
                        Divider()
                        Button {
                            Task { await startDeposit() }
                        } label: {
                            HStack(spacing: 6) {
                                if depositLoading { ProgressView().tint(.white) }
                                Label("Pay deposit", systemImage: "lock.shield.fill")
                            }
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 38)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.success)
                        .disabled(depositLoading)

                        if let depositError {
                            Text(depositError).font(.caption).foregroundStyle(.red)
                        }
                        Text("Pay a deposit to confirm the job — secured in-app.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(16)
        }
        .sheet(isPresented: $showSendQuote) {
            SendQuoteSheet(quote: quote) { low, high, note in
                await onUpdate(.quoted, low, high, note)
            }
        }
        .sheet(item: $depositURL, onDismiss: { Task { await onReload() } }) { url in
            SafariView(url: url).ignoresSafeArea()
        }
    }

    private func startDeposit() async {
        depositLoading = true
        depositError = nil
        defer { depositLoading = false }
        do {
            let checkout = try await APIService.shared.depositCheckout(quoteRequestId: quote.id)
            depositURL = URL(string: checkout.url)
        } catch {
            depositError = error.localizedDescription
        }
    }

    @ViewBuilder
    private func detailRow(icon: String, text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).foregroundStyle(.secondary)
            Text(text).font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private func handle(_ action: QuoteAction) {
        if action.opensSendSheet {
            showSendQuote = true
            return
        }
        Task {
            working = true
            await onUpdate(action.status, nil, nil, nil)
            working = false
        }
    }

    // Available actions depend on role + current status.
    private var actions: [QuoteAction] {
        switch (isBusiness, quote.status) {
        case (true, .pending):
            return [.init(status: .quoted, label: "Send quote", tint: Theme.primary, opensSendSheet: true),
                    .init(status: .declined, label: "Decline", tint: .red)]
        case (false, .quoted):
            return [.init(status: .accepted, label: "Accept", tint: Theme.primary),
                    .init(status: .withdrawn, label: "Withdraw", tint: .red)]
        case (false, .pending):
            return [.init(status: .withdrawn, label: "Withdraw", tint: .red)]
        default:
            return []
        }
    }
}

private struct QuoteAction: Identifiable {
    var id: String { status.rawValue }
    let status: QuoteStatus
    let label: String
    let tint: Color
    var opensSendSheet: Bool = false
}

// MARK: - Status badge

private struct QuoteStatusBadge: View {
    let status: QuoteStatus

    private var color: Color {
        switch status {
        case .pending: return Theme.gold
        case .quoted: return Theme.primary
        case .accepted: return Theme.success
        case .declined, .withdrawn: return Color(.systemGray)
        }
    }

    var body: some View {
        Label(status.label, systemImage: status.systemImage)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.16))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}

// MARK: - Send-quote sheet (contractor)

/// Contractor-facing sheet to attach a price range and note to a quote request.
private struct SendQuoteSheet: View {
    let quote: QuoteRequest
    var onSend: (Int, Int, String?) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var low = ""
    @State private var high = ""
    @State private var note = ""
    @State private var working = false

    private var lowVal: Int? { Int(low) }
    private var highVal: Int? { Int(high) }
    private var isValid: Bool {
        guard let l = lowVal, let h = highVal else { return false }
        return h >= l
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("The project") {
                    Text(quote.description).font(.subheadline).foregroundStyle(.secondary)
                    if let budget = quote.budgetText {
                        Text("Homeowner's budget: \(budget)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section("Your estimate") {
                    HStack {
                        Text("$")
                        TextField("Low", text: $low).keyboardType(.numberPad)
                        Text("–")
                        TextField("High", text: $high).keyboardType(.numberPad)
                    }
                    if !low.isEmpty, !high.isEmpty, !isValid {
                        Text("High must be at least the low price.")
                            .font(.caption).foregroundStyle(.red)
                    }
                }

                Section("Note (optional)") {
                    TextField("What's included, assumptions, next steps…", text: $note, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section {
                    Button {
                        Task {
                            working = true
                            await onSend(lowVal ?? 0, highVal ?? 0, note.isEmpty ? nil : note)
                            working = false
                            dismiss()
                        }
                    } label: {
                        if working {
                            HStack { ProgressView(); Text("Sending…") }
                        } else {
                            Text("Send quote")
                        }
                    }
                    .disabled(!isValid || working)
                }
            }
            .navigationTitle("Send a Quote")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
