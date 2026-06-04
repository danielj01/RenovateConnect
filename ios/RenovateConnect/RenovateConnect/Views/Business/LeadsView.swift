import SwiftUI

struct LeadsView: View {
    @State private var leads: [Lead] = []
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var filter: LeadStatus?
    @State private var selected: Lead?

    private var filtered: [Lead] {
        guard let filter else { return leads }
        return leads.filter { $0.status == filter }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else if let loadError {
                    errorState(loadError)
                } else if leads.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .background(Color(.systemBackground))
            .navigationTitle("Leads")
            .task { await load() }
            .refreshable { await load() }
            .sheet(item: $selected) { lead in
                LeadDetailSheet(lead: lead) { updated in
                    if let i = leads.firstIndex(where: { $0.id == updated.id }) { leads[i] = updated }
                }
            }
        }
    }

    private var list: some View {
        ScrollView {
            VStack(spacing: 14) {
                filterBar
                ForEach(filtered) { lead in
                    Button { selected = lead } label: { LeadRow(lead: lead) }
                        .buttonStyle(.plain)
                }
                if filtered.isEmpty {
                    Text("No \(filter?.label.lowercased() ?? "") leads")
                        .font(.callout).foregroundStyle(.secondary).padding(.top, 40)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterChip(title: "All", count: leads.count, isOn: filter == nil) { filter = nil }
                ForEach(LeadStatus.allCases) { status in
                    let c = leads.filter { $0.status == status }.count
                    FilterChip(title: status.label, count: c, isOn: filter == status) {
                        filter = (filter == status) ? nil : status
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.2.slash")
                .font(.system(size: 44)).foregroundStyle(.secondary)
            Text("No leads yet").font(.headline)
            Text("When a homeowner contacts you, they'll show up here so you can track them.")
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal, 40)
        }
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 44)).foregroundStyle(.secondary)
            Text("Couldn't load leads").font(.headline)
            Text(message)
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal, 40)
            Button("Try Again") { Task { await load() } }
                .buttonStyle(.borderedProminent)
                .tint(Theme.primary)
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            leads = try await APIService.shared.myLeads()
            loadError = nil
        } catch {
            if leads.isEmpty { loadError = error.localizedDescription }
        }
    }
}

// MARK: - Row

struct LeadRow: View {
    let lead: Lead

    var body: some View {
        RCCard {
            HStack(spacing: 12) {
                InitialsAvatar(name: lead.clientName, size: 44)
                    .clipShape(Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(lead.clientName).font(.subheadline.weight(.semibold))
                    if let value = lead.estimatedValue, value > 0 {
                        Text("$\(value.formatted()) est.").font(.caption).foregroundStyle(.secondary)
                    } else if let notes = lead.notes, !notes.isEmpty {
                        Text(notes).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    } else {
                        Text("Tap to manage").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                LeadStatusBadge(status: lead.status)
            }
            .padding(14)
        }
    }
}

struct LeadStatusBadge: View {
    let status: LeadStatus

    var body: some View {
        Label(status.label, systemImage: status.systemImage)
            .font(.system(size: 11, weight: .semibold))
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(tint.opacity(0.15))
            .foregroundStyle(tint)
            .clipShape(Capsule())
    }

    private var tint: Color {
        switch status {
        case .new: return Theme.primary
        case .contacted: return .blue
        case .converted: return .green
        case .closed: return .gray
        }
    }
}

struct FilterChip: View {
    let title: String
    let count: Int
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(title)
                Text("\(count)")
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .background(isOn ? Color.white.opacity(0.25) : Color(.systemGray5))
                    .clipShape(Capsule())
            }
            .font(.system(size: 13, weight: .semibold))
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(isOn ? Theme.primary : Color(.systemBackground))
            .foregroundStyle(isOn ? .white : .primary)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Color(.systemGray4), lineWidth: isOn ? 0 : 1))
        }
    }
}

// MARK: - Detail / editor

struct LeadDetailSheet: View {
    let lead: Lead
    let onSave: (Lead) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var status: LeadStatus
    @State private var notes: String
    @State private var valueText: String
    @State private var isSaving = false
    @State private var loadingThread = false
    @State private var thread: Conversation?
    @State private var saveError: String?

    init(lead: Lead, onSave: @escaping (Lead) -> Void) {
        self.lead = lead
        self.onSave = onSave
        _status = State(initialValue: lead.status)
        _notes = State(initialValue: lead.notes ?? "")
        _valueText = State(initialValue: lead.estimatedValue.map { "\($0)" } ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Client") {
                    LabeledContent("Name", value: lead.clientName)
                    if let email = lead.conversation?.client?.email {
                        LabeledContent("Email", value: email)
                    }
                    if let phone = lead.conversation?.client?.phone, !phone.isEmpty {
                        LabeledContent("Phone", value: phone)
                    }
                    LabeledContent("Received", value: Self.receivedText(lead.createdAt))

                    Button {
                        Task { await openThread() }
                    } label: {
                        HStack {
                            Label("Message client", systemImage: "bubble.left.and.bubble.right.fill")
                            Spacer()
                            if loadingThread { ProgressView() }
                        }
                    }
                    .disabled(lead.conversation == nil || loadingThread)
                }

                Section("Status") {
                    Picker("Status", selection: $status) {
                        ForEach(LeadStatus.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Estimated job value") {
                    HStack {
                        Text("$")
                        TextField("0", text: $valueText)
                            .keyboardType(.numberPad)
                    }
                }

                Section("Private notes") {
                    TextField("Add notes about this lead…", text: $notes, axis: .vertical)
                        .lineLimit(3...8)
                }
            }
            .navigationTitle("Lead")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(item: $thread) { conv in
                MessagingView(conversation: conv)
            }
            .alert("Couldn't save", isPresented: Binding(
                get: { saveError != nil },
                set: { if !$0 { saveError = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(saveError ?? "")
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving { ProgressView() }
                    else { Button("Save") { Task { await save() } }.bold() }
                }
            }
        }
    }

    // Load the full conversation (MessagingView needs the object, not just an id)
    // then push the chat thread.
    private func openThread() async {
        guard let id = lead.conversation?.id else { return }
        loadingThread = true
        defer { loadingThread = false }
        thread = try? await APIService.shared.getConversation(id: id)
    }

    // "Today" / "Yesterday" / a medium date from the lead's ISO createdAt.
    private static func receivedText(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return "—" }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        let out = DateFormatter()
        out.dateStyle = .medium
        return out.string(from: date)
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let value = Int(valueText.filter(\.isNumber))
        do {
            let updated = try await APIService.shared.updateLead(
                id: lead.id, status: status,
                notes: notes.isEmpty ? nil : notes,
                estimatedValue: value
            )
            onSave(updated)
            dismiss()
        } catch {
            saveError = error.localizedDescription
        }
    }
}
