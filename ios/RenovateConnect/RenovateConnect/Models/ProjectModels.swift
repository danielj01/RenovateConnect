import Foundation

// The Project hub is a derived view: each "project" is everything tied to one
// homeowner↔contractor pair (quotes, appointments, payments, the conversation).
// These models decode the read-only aggregation served by GET /projects and
// GET /projects/:businessId — there's no Project table on the backend.

/// One card in the Projects list: a contractor the user has an active
/// engagement with, plus at-a-glance counts and a single headline.
struct ProjectSummary: Codable, Identifiable {
    let businessId: String
    let companyName: String
    let logoUrl: String?
    let city: String?
    let verified: Bool
    let headline: String
    let openQuoteCount: Int
    let upcomingAppointmentCount: Int
    let unreadCount: Int
    let paymentCount: Int
    // Milestone escrow progress (0 when this engagement has no project yet).
    let milestoneTotal: Int
    let milestonesReleased: Int
    let escrowCents: Int
    /// How many milestones need the *viewer* to act (homeowner: approve
    /// submitted work; contractor: submit funded work).
    let milestoneActionCount: Int
    let lastActivityAt: String?

    var id: String { businessId }

    /// Money currently held in escrow, formatted as whole dollars.
    var escrowText: String {
        "$\(Int(Double(escrowCents) / 100).formatted())"
    }
}

/// The full aggregated timeline for one engagement.
struct ProjectDetail: Codable {
    let business: ProjectBusiness
    let conversationId: String?
    let unreadCount: Int
    /// The persisted Project + milestone escrow, if it's been set up for this pair.
    let project: ProjectRecord?
    let quotes: [ProjectQuote]
    let appointments: [ProjectAppointment]
    let payments: [ProjectPayment]
}

// MARK: - Milestone escrow

enum MilestoneStatus: String, Codable {
    case pending = "PENDING"
    case funded = "FUNDED"
    case submitted = "SUBMITTED"
    case disputed = "DISPUTED"
    case approved = "APPROVED"
    case refunded = "REFUNDED"

    var label: String {
        switch self {
        case .pending: return "Not funded"
        case .funded: return "In escrow"
        case .submitted: return "Awaiting your approval"
        case .disputed: return "Disputed — under review"
        case .approved: return "Released"
        case .refunded: return "Refunded"
        }
    }

    var systemImage: String {
        switch self {
        case .pending: return "circle.dashed"
        case .funded: return "lock.fill"
        case .submitted: return "photo.on.rectangle.angled"
        case .disputed: return "exclamationmark.triangle.fill"
        case .approved: return "checkmark.seal.fill"
        case .refunded: return "arrow.uturn.backward.circle.fill"
        }
    }
}

/// The persisted project container holding milestone escrow stages.
struct ProjectRecord: Codable {
    let id: String
    let title: String
    let status: String
    let quoteRequestId: String?
    /// Homeowner-only scratchpad surfaced in the project hub. Server omits the
    /// field for the contractor side.
    var clientNotes: String?
    let createdAt: String
    let milestones: [Milestone]
}

struct Milestone: Codable, Identifiable {
    let id: String
    let title: String
    let amountCents: Int
    let status: MilestoneStatus
    let proofUrls: [String]
    let fundedAt: String?
    let submittedAt: String?
    let approvedAt: String?
    let createdAt: String

    /// Contractor's portion, formatted as dollars.
    var amountText: String {
        "$\(Int(Double(amountCents) / 100).formatted())"
    }
}

struct ProjectBusiness: Codable {
    let id: String
    let companyName: String
    let logoUrl: String?
    let city: String?
    let verified: Bool
    let payoutsEnabled: Bool
}

struct ProjectQuote: Codable, Identifiable {
    let id: String
    let category: String?
    let description: String
    let status: QuoteStatus
    let quoteLow: Int?
    let quoteHigh: Int?
    let paymentStatus: PaymentStatus?
    let createdAt: String
    let updatedAt: String
}

struct ProjectAppointment: Codable, Identifiable {
    let id: String
    let scheduledAt: String
    let status: AppointmentStatus
    let note: String?
    let createdAt: String
}

struct ProjectPayment: Codable, Identifiable {
    let id: String
    let amountCents: Int
    /// Platform fee charged on top of the contractor's portion. Surfaced on
    /// the receipt sheet so the homeowner can see the line-item breakdown.
    var commissionCents: Int?
    /// "DEPOSIT" for a quote-acceptance payment, "MILESTONE" for an escrow
    /// stage. Drives the receipt copy ("Deposit on…" vs "Milestone funded").
    var kind: String?
    var description: String?
    let status: PaymentStatus
    let paidAt: String?
    var refundedAt: String?
    let createdAt: String

    var totalText: String { "$\(Int(Double(amountCents) / 100).formatted())" }
    var commissionText: String? {
        guard let c = commissionCents else { return nil }
        return "$\(Int(Double(c) / 100).formatted())"
    }
    var contractorPortionText: String? {
        guard let c = commissionCents else { return nil }
        let portion = amountCents - c
        return "$\(Int(Double(portion) / 100).formatted())"
    }
}

// MARK: - Unified timeline

/// A single chronological event in a project's timeline, built on the client by
/// merging quotes, appointments and payments and sorting by date. Keeping the
/// merge client-side means the backend stays a plain read aggregation.
struct ProjectTimelineEvent: Identifiable {
    enum Kind {
        case quote(ProjectQuote)
        case appointment(ProjectAppointment)
        case payment(ProjectPayment)
    }

    let id: String
    let date: Date
    let kind: Kind

    var systemImage: String {
        switch kind {
        case .quote(let q): return q.status.systemImage
        case .appointment(let a): return a.status.systemImage
        case .payment: return "creditcard.fill"
        }
    }

    var title: String {
        switch kind {
        case .quote(let q):
            return q.category.map { "\($0) quote" } ?? "Quote request"
        case .appointment:
            return "Appointment"
        case .payment:
            return "Deposit"
        }
    }

    var subtitle: String {
        switch kind {
        case .quote(let q):
            if let range = QuoteRequest.rangeText(q.quoteLow, q.quoteHigh) {
                return "\(q.status.label) · \(range)"
            }
            return q.status.label
        case .appointment(let a):
            return "\(a.status.label) · \(Self.dateText(a.scheduledAt))"
        case .payment(let p):
            let dollars = Double(p.amountCents) / 100
            return "\(p.status.label) · $\(Int(dollars).formatted())"
        }
    }

    static func dateText(_ iso: String) -> String {
        guard let date = ProjectDateFormat.parse(iso) else { return "" }
        let fmt = DateFormatter()
        fmt.dateStyle = .medium
        fmt.timeStyle = .short
        return fmt.string(from: date)
    }
}

extension ProjectDetail {
    /// Merge all artifacts into one timeline, newest first.
    var timeline: [ProjectTimelineEvent] {
        var events: [ProjectTimelineEvent] = []
        for q in quotes {
            if let d = ProjectDateFormat.parse(q.createdAt) {
                events.append(.init(id: "q-\(q.id)", date: d, kind: .quote(q)))
            }
        }
        for a in appointments {
            if let d = ProjectDateFormat.parse(a.createdAt) {
                events.append(.init(id: "a-\(a.id)", date: d, kind: .appointment(a)))
            }
        }
        for p in payments {
            if let d = ProjectDateFormat.parse(p.createdAt) {
                events.append(.init(id: "p-\(p.id)", date: d, kind: .payment(p)))
            }
        }
        return events.sorted { $0.date > $1.date }
    }
}

// MARK: - Helpers

/// Tolerant ISO-8601 parsing (with and without fractional seconds), shared by
/// the project timeline.
enum ProjectDateFormat {
    static func parse(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }
}
