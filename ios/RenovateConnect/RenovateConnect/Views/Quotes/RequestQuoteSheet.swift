import SwiftUI

/// Homeowner-facing sheet to send a structured project brief to a contractor
/// and request a price estimate.
struct RequestQuoteSheet: View {
    let business: Business
    var onComplete: (() async -> Void)? = nil

    @Environment(\.dismiss) private var dismiss

    @State private var category: String
    @State private var description = ""
    @State private var budgetMin = ""
    @State private var budgetMax = ""
    @State private var timeline = "Flexible"
    @State private var isLoading = false
    @State private var sent = false
    @State private var error: String?

    private let timelines = ["Flexible", "Within 1 month", "1–3 months", "ASAP"]

    init(business: Business, onComplete: (() async -> Void)? = nil) {
        self.business = business
        self.onComplete = onComplete
        // Pre-select the contractor's first specialty as a sensible default.
        _category = State(initialValue: business.specialties.first ?? "")
    }

    private var canSubmit: Bool {
        !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isLoading
    }

    var body: some View {
        NavigationStack {
            Form {
                if sent {
                    Section {
                        VStack(spacing: 12) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 54)).foregroundStyle(.green)
                            Text("Request sent!").font(.title3.bold())
                            Text("\(business.companyName) will review your project and send an estimate. Track it under Quotes.")
                                .font(.subheadline)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                    }
                } else {
                    if !business.specialties.isEmpty {
                        Section("Project type") {
                            Picker("Category", selection: $category) {
                                ForEach(business.specialties, id: \.self) { Text($0).tag($0) }
                            }
                        }
                    }

                    Section("Describe the work") {
                        TextField("e.g. Gut and rebuild a 200 sq ft kitchen — new cabinets, quartz counters, tile floor…",
                                  text: $description, axis: .vertical)
                            .lineLimit(4...10)
                    }

                    Section("Budget (optional)") {
                        HStack {
                            Text("$")
                            TextField("Min", text: $budgetMin).keyboardType(.numberPad)
                            Text("–")
                            TextField("Max", text: $budgetMax).keyboardType(.numberPad)
                        }
                    }

                    Section("Timeline") {
                        Picker("When", selection: $timeline) {
                            ForEach(timelines, id: \.self) { Text($0).tag($0) }
                        }
                    }

                    if let error {
                        Section { Text(error).foregroundStyle(.red).font(.caption) }
                    }

                    Section {
                        Button {
                            Task { await submit() }
                        } label: {
                            if isLoading {
                                HStack { ProgressView(); Text("Sending…") }
                            } else {
                                Text("Send quote request")
                            }
                        }
                        .disabled(!canSubmit)
                    }
                }
            }
            .navigationTitle("Request a Quote")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(sent ? "Done" : "Cancel") { dismiss() }
                }
            }
        }
    }

    private func submit() async {
        isLoading = true; error = nil
        defer { isLoading = false }
        do {
            _ = try await APIService.shared.createQuoteRequest(
                businessId: business.id,
                description: description.trimmingCharacters(in: .whitespacesAndNewlines),
                category: category.isEmpty ? nil : category,
                budgetMin: Int(budgetMin),
                budgetMax: Int(budgetMax),
                timeline: timeline
            )
            sent = true
            await onComplete?()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
