import SwiftUI

/// Lets a business owner set their weekly open hours. Each weekday can be marked
/// open (with an open/close time) or closed. Saving replaces the whole week.
struct BusinessHoursEditorView: View {
    let businessId: String
    var onComplete: () async -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var days: [EditableDay]
    @State private var isLoading = false
    @State private var error: String?

    init(businessId: String, existing: [BusinessHours], onComplete: @escaping () async -> Void) {
        self.businessId = businessId
        self.onComplete = onComplete
        // Seed all seven days, pulling from existing rows where present and
        // defaulting unset days to a closed 9–5.
        let byDay = Dictionary(uniqueKeysWithValues: existing.map { ($0.dayOfWeek, $0) })
        _days = State(initialValue: (0...6).map { dow in
            if let row = byDay[dow] {
                return EditableDay(dayOfWeek: dow, isOpen: !row.closed,
                                   open: row.openMinute, close: row.closeMinute)
            }
            // Sensible default: weekdays 9–5 open, weekends closed.
            let weekend = (dow == 0 || dow == 6)
            return EditableDay(dayOfWeek: dow, isOpen: !weekend, open: 540, close: 1020)
        })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Set the times you accept appointments. Homeowners can only request slots inside these hours.")
                        .font(.caption).foregroundStyle(.secondary)
                }

                ForEach($days) { $day in
                    Section(BusinessHours.weekdayNames[day.dayOfWeek]) {
                        Toggle("Open", isOn: $day.isOpen)
                            .tint(Theme.primary)

                        if day.isOpen {
                            DatePicker("Opens",
                                       selection: Binding(
                                        get: { Self.date(fromMinute: day.open) },
                                        set: { day.open = Self.minute(from: $0) }),
                                       displayedComponents: .hourAndMinute)
                            DatePicker("Closes",
                                       selection: Binding(
                                        get: { Self.date(fromMinute: day.close) },
                                        set: { day.close = Self.minute(from: $0) }),
                                       displayedComponents: .hourAndMinute)
                            if day.close <= day.open {
                                Text("Closing time must be after opening time.")
                                    .font(.caption).foregroundStyle(.red)
                            }
                        }
                    }
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.caption) }
                }
            }
            .navigationTitle("Business Hours")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isLoading {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(!isValid)
                    }
                }
            }
        }
    }

    /// All open days must have a close time after their open time.
    private var isValid: Bool {
        days.allSatisfy { !$0.isOpen || $0.close > $0.open }
    }

    private func save() async {
        guard isValid else { return }
        isLoading = true; error = nil
        defer { isLoading = false }
        let payload = days.map {
            BusinessHours(id: nil, dayOfWeek: $0.dayOfWeek,
                          openMinute: $0.open, closeMinute: $0.close, closed: !$0.isOpen)
        }
        do {
            _ = try await APIService.shared.updateBusinessHours(businessId: businessId, hours: payload)
            await onComplete()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Minute <-> Date bridging for the time pickers

    /// A throwaway Date on a fixed day carrying just the hour/minute, so
    /// DatePicker can edit a minute-of-day value.
    static func date(fromMinute minute: Int) -> Date {
        var comps = DateComponents()
        comps.year = 2000; comps.month = 1; comps.day = 1
        comps.hour = minute / 60; comps.minute = minute % 60
        return Calendar.current.date(from: comps) ?? Date()
    }

    static func minute(from date: Date) -> Int {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }
}

/// Mutable per-weekday editing state.
private struct EditableDay: Identifiable {
    let dayOfWeek: Int
    var isOpen: Bool
    var open: Int   // minutes from midnight
    var close: Int
    var id: Int { dayOfWeek }
}
