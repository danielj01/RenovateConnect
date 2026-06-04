import SwiftUI

/// Role-aware appointment list. Homeowners see who they've booked and can
/// cancel; contractors see incoming requests and can confirm or decline.
struct AppointmentsView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var appointments: [Appointment] = []
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
                    Label("Couldn't load appointments", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Try Again") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.primary)
                }
                .padding(.top, 60)
            } else if appointments.isEmpty {
                ContentUnavailableView {
                    Label("No appointments", systemImage: "calendar")
                } description: {
                    Text(isBusiness
                         ? "Appointment requests from homeowners will appear here."
                         : "Request a time with a contractor from their profile.")
                }
                .padding(.top, 60)
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(appointments) { appt in
                        AppointmentCard(
                            appointment: appt,
                            isBusiness: isBusiness,
                            onUpdate: { status in await update(appt, to: status) }
                        )
                        .padding(.horizontal, 16)
                    }
                }
                .padding(.vertical, 12)
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle("Appointments")
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
            appointments = try await APIService.shared.myAppointments()
            loadError = nil
        } catch {
            // Keep an already-loaded list visible if a refresh fails.
            if appointments.isEmpty { loadError = error.localizedDescription }
        }
    }

    private func update(_ appt: Appointment, to status: AppointmentStatus) async {
        do {
            let updated = try await APIService.shared.updateAppointment(id: appt.id, status: status)
            if let idx = appointments.firstIndex(where: { $0.id == updated.id }) {
                appointments[idx] = updated
            }
        } catch {
            actionError = error.localizedDescription
        }
    }
}

// MARK: - Card

private struct AppointmentCard: View {
    let appointment: Appointment
    let isBusiness: Bool
    let onUpdate: (AppointmentStatus) async -> Void

    @State private var working = false
    @State private var showReview = false

    // Homeowners can review a contractor once the appointment is confirmed.
    private var canReview: Bool {
        !isBusiness && appointment.status == .confirmed && appointment.business != nil
    }

    private var counterpartyName: String {
        isBusiness
            ? (appointment.client?.name ?? "Homeowner")
            : (appointment.business?.companyName ?? "Contractor")
    }

    var body: some View {
        RCCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label(counterpartyName, systemImage: isBusiness ? "person.fill" : "building.2.fill")
                        .font(.headline)
                        .foregroundStyle(Theme.primary)
                    Spacer()
                    StatusBadge(status: appointment.status)
                }

                HStack(spacing: 8) {
                    Image(systemName: "calendar")
                        .foregroundStyle(.secondary)
                    Text(appointment.scheduledAt.appointmentDateText)
                        .font(.subheadline.weight(.medium))
                }

                HStack(spacing: 8) {
                    Image(systemName: "clock")
                        .foregroundStyle(.secondary)
                    Text("\(appointment.durationMin) min")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if let note = appointment.note, !note.isEmpty {
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }

                if !actions.isEmpty {
                    Divider()
                    HStack(spacing: 10) {
                        ForEach(actions) { action in
                            Button {
                                Task {
                                    working = true
                                    await onUpdate(action.status)
                                    working = false
                                }
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

                if canReview {
                    Divider()
                    Button {
                        showReview = true
                    } label: {
                        Label("Leave a review", systemImage: "star.bubble")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 38)
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.primary)
                }
            }
            .padding(16)
        }
        .sheet(isPresented: $showReview) {
            if let biz = appointment.business {
                WriteReviewSheet(businessId: biz.id, businessName: biz.companyName) { }
            }
        }
    }

    // Which actions are available depends on role + current status.
    private var actions: [AppointmentAction] {
        switch (isBusiness, appointment.status) {
        case (true, .requested):
            return [.init(status: .confirmed, label: "Confirm", tint: Theme.primary),
                    .init(status: .declined, label: "Decline", tint: .red)]
        case (false, .requested), (false, .confirmed):
            return [.init(status: .cancelled, label: "Cancel", tint: .red)]
        default:
            return []
        }
    }
}

/// One actionable status transition rendered as a button on an appointment card.
private struct AppointmentAction: Identifiable {
    var id: AppointmentStatus { status }
    let status: AppointmentStatus
    let label: String
    let tint: Color
}

// MARK: - Status badge

private struct StatusBadge: View {
    let status: AppointmentStatus

    private var color: Color {
        switch status {
        case .requested: return Theme.gold
        case .confirmed: return Theme.success
        case .declined, .cancelled: return Color(.systemGray)
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

// MARK: - Booking sheet

/// Homeowner-facing sheet to request a time with a contractor.
struct BookAppointmentSheet: View {
    let business: Business
    @Environment(\.dismiss) private var dismiss

    @State private var date = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @State private var durationMin = 60
    @State private var note = ""
    @State private var isLoading = false
    @State private var sent = false
    @State private var error: String?

    private let durations = [30, 60, 90, 120]

    var body: some View {
        NavigationStack {
            Form {
                if sent {
                    Section {
                        VStack(spacing: 12) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 54)).foregroundStyle(.green)
                            Text("Request sent!").font(.title3.bold())
                            Text("\(business.companyName) will confirm or suggest another time. You can track it under Appointments.")
                                .font(.subheadline)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                    }
                } else {
                    Section("When") {
                        DatePicker("Date & time", selection: $date, in: Date()...,
                                   displayedComponents: [.date, .hourAndMinute])
                    }

                    Section("Duration") {
                        Picker("Estimated length", selection: $durationMin) {
                            ForEach(durations, id: \.self) { Text("\($0) min").tag($0) }
                        }
                    }

                    Section("Note (optional)") {
                        TextField("What would you like to discuss?", text: $note, axis: .vertical)
                            .lineLimit(3...6)
                    }

                    if let error {
                        Section { Text(error).foregroundStyle(.red).font(.caption) }
                    }

                    Section {
                        Button {
                            Task { await submit() }
                        } label: {
                            if isLoading {
                                HStack { ProgressView(); Text("Sending request…") }
                            } else {
                                Text("Request appointment")
                            }
                        }
                        .disabled(isLoading)
                    }
                }
            }
            .navigationTitle("Book \(business.companyName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(sent ? "Done" : "Cancel") { dismiss() }
                }
            }
        }
    }

    private func submit() async {
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            _ = try await APIService.shared.requestAppointment(
                businessId: business.id,
                scheduledAt: date,
                durationMin: durationMin,
                note: note.isEmpty ? nil : note
            )
            sent = true
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Helpers

private extension String {
    /// Render an ISO-8601 scheduledAt timestamp as a friendly local date+time.
    var appointmentDateText: String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = iso.date(from: self) ?? ISO8601DateFormatter().date(from: self)
        guard let date else { return self }
        let fmt = DateFormatter()
        fmt.dateStyle = .medium
        fmt.timeStyle = .short
        return fmt.string(from: date)
    }
}
