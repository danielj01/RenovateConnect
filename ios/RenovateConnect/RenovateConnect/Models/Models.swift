import Foundation

struct User: Codable, Identifiable {
    let id: String
    let email: String
    let name: String
    let role: UserRole
    let phone: String?
    let avatarUrl: String?
    let business: Business?
    var pushEnabled: Bool?
    var notifyLeads: Bool?
    var notifyMessages: Bool?
    var notifyAppointments: Bool?
    var notifyReviews: Bool?
}

enum UserRole: String, Codable {
    case client = "CLIENT"
    case business = "BUSINESS"
    case admin = "ADMIN"
}

struct Business: Codable, Identifiable {
    let id: String
    let companyName: String
    let description: String
    let logoUrl: String?
    let city: String
    let state: String
    let specialties: [String]
    let averageRating: Double
    let reviewCount: Int
    let isPromoted: Bool
    let yearsInBusiness: Int
    let website: String?
    let reviews: [Review]?
    var profileViews: Int?
    var portfolio: [PortfolioProject]?
    var hours: [BusinessHours]?

    // Trust signals
    var verified: Bool?
    var verifiedAt: String?
    var licenseNumber: String?

    var isVerified: Bool { verified ?? false }
}

/// A contractor's recurring open hours for one weekday. Times are minutes from
/// midnight (e.g. 540 = 9:00 AM). `closed` overrides the time fields.
struct BusinessHours: Codable, Identifiable {
    let id: String?
    let dayOfWeek: Int        // 0 = Sunday … 6 = Saturday
    let openMinute: Int
    let closeMinute: Int
    let closed: Bool

    // Identity for SwiftUI lists even before the row has a server id (editor rows).
    var listId: Int { dayOfWeek }

    static let weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday",
                              "Thursday", "Friday", "Saturday"]
    static let weekdayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    var dayName: String { Self.weekdayNames[safe: dayOfWeek] ?? "Day \(dayOfWeek)" }
    var dayShort: String { Self.weekdayShort[safe: dayOfWeek] ?? "?" }

    /// "9:00 AM – 5:00 PM", or "Closed".
    var rangeText: String {
        guard !closed else { return "Closed" }
        return "\(Self.formatMinute(openMinute)) – \(Self.formatMinute(closeMinute))"
    }

    static func formatMinute(_ minute: Int) -> String {
        let h24 = minute / 60
        let m = minute % 60
        let period = h24 >= 12 ? "PM" : "AM"
        var h = h24 % 12
        if h == 0 { h = 12 }
        return m == 0 ? "\(h) \(period)" : String(format: "%d:%02d %@", h, m, period)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

struct Review: Codable, Identifiable {
    let id: String
    let authorId: String?
    let authorName: String
    let rating: Int
    let body: String?
    let verified: Bool?
    let createdAt: String
    // Public reply from the reviewed business, if any.
    var response: String?
    var respondedAt: String?

    var isVerified: Bool { verified ?? false }
    var hasResponse: Bool { !(response ?? "").isEmpty }
}

struct Conversation: Codable, Identifiable, Hashable {
    let id: String
    let businessId: String
    let business: BusinessSummary?
    let updatedAt: String
    let messages: [ChatMessage]?
    var unreadCount: Int?

    // Read receipts: when each participant last opened the thread. Used to show
    // a "Seen" indicator under the sender's latest message.
    var clientLastReadAt: String?
    var businessLastReadAt: String?

    var hasUnread: Bool { (unreadCount ?? 0) > 0 }

    // Identity-based conformance so the type can drive `navigationDestination(item:)`
    // without forcing Hashable on every nested model.
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    static func == (lhs: Conversation, rhs: Conversation) -> Bool { lhs.id == rhs.id }
}

struct BusinessSummary: Codable {
    let id: String
    let companyName: String
    let logoUrl: String?
    let city: String
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let conversationId: String
    let senderId: String
    let body: String
    let createdAt: String
}

struct Estimation: Codable, Identifiable {
    let id: String
    let imageUrls: [String]
    let roomType: String?
    let description: String?
    let result: EstimationResult
    let createdAt: String
}

struct EstimationResult: Codable {
    let summary: String
    let lineItems: [LineItem]
    let totalLow: Double
    let totalHigh: Double
    let currency: String
    let confidence: String
    let notes: String
}

struct LineItem: Codable, Identifiable {
    var id: String { item }
    let item: String
    let low: Double
    let high: Double
    let unit: String
}

// MARK: - AI chat

/// A reference to a business the AI assistant named, used to deep-link from a
/// chat reply straight to its detail page.
struct BusinessRef: Codable, Identifiable, Hashable {
    let id: String
    let companyName: String
}

/// One turn in the AI assistant conversation. Persisted so history survives
/// tab switches and app restarts.
struct ChatTurn: Codable, Identifiable {
    var id = UUID()
    let role: String          // "user" | "assistant"
    let content: String
    var mentioned: [BusinessRef] = []

    var isUser: Bool { role == "user" }
}

struct AuthResponse: Codable {
    let token: String
    let user: User
}

struct BusinessSearchResponse: Codable {
    let businesses: [Business]
    let total: Int
    let page: Int
    let limit: Int
}

// MARK: - Saved searches

/// A homeowner's stored search criteria. When a new contractor appears that
/// matches, the owner gets an alert (push + activity feed). Each non-nil field
/// narrows the match.
struct SavedSearch: Codable, Identifiable {
    let id: String
    let name: String?
    let specialty: String?
    let city: String?
    let state: String?
    let q: String?
    let createdAt: String

    /// A human-readable label for the row, falling back to a description of the
    /// criteria when the user didn't name the search.
    var displayLabel: String {
        if let name, !name.isEmpty { return name }
        var parts: [String] = []
        if let specialty { parts.append(specialty) }
        if let q { parts.append("\u{201C}\(q)\u{201D}") }
        let loc = [city, state].compactMap { $0 }.joined(separator: ", ")
        if !loc.isEmpty { parts.append("in \(loc)") }
        return parts.isEmpty ? "Saved search" : parts.joined(separator: " ")
    }
}

// MARK: - Business-side features

struct PortfolioProject: Codable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let category: String?
    let costMin: Int?
    let costMax: Int?
    let durationWeeks: Int?
    let imageUrls: [String]
    let featured: Bool

    var costRangeText: String? {
        switch (costMin, costMax) {
        case let (lo?, hi?): return "$\(lo.formatted()) – $\(hi.formatted())"
        case let (lo?, nil): return "From $\(lo.formatted())"
        case let (nil, hi?): return "Up to $\(hi.formatted())"
        default: return nil
        }
    }
}

enum LeadStatus: String, Codable, CaseIterable, Identifiable {
    case new = "NEW"
    case contacted = "CONTACTED"
    case converted = "CONVERTED"
    case closed = "CLOSED"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .new: return "New"
        case .contacted: return "Contacted"
        case .converted: return "Won"
        case .closed: return "Closed"
        }
    }

    var systemImage: String {
        switch self {
        case .new: return "sparkles"
        case .contacted: return "phone.fill"
        case .converted: return "checkmark.seal.fill"
        case .closed: return "xmark.circle.fill"
        }
    }
}

struct Lead: Codable, Identifiable {
    let id: String
    var status: LeadStatus
    var notes: String?
    var estimatedValue: Int?
    let createdAt: String
    let conversation: LeadConversation?

    var clientName: String { conversation?.client?.name ?? "Unknown client" }
}

struct LeadConversation: Codable {
    let id: String
    let client: LeadClient?
}

struct LeadClient: Codable {
    let id: String
    let name: String
    let email: String
    let phone: String?
}

// MARK: - Appointments

enum AppointmentStatus: String, Codable, CaseIterable, Identifiable {
    case requested = "REQUESTED"
    case confirmed = "CONFIRMED"
    case declined = "DECLINED"
    case cancelled = "CANCELLED"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .requested: return "Requested"
        case .confirmed: return "Confirmed"
        case .declined: return "Declined"
        case .cancelled: return "Cancelled"
        }
    }

    var systemImage: String {
        switch self {
        case .requested: return "clock"
        case .confirmed: return "checkmark.circle.fill"
        case .declined: return "xmark.circle.fill"
        case .cancelled: return "slash.circle.fill"
        }
    }
}

struct Appointment: Codable, Identifiable {
    let id: String
    let scheduledAt: String
    let durationMin: Int
    let note: String?
    var status: AppointmentStatus
    let createdAt: String
    let business: BusinessSummary?
    let client: AppointmentClient?
}

struct AppointmentClient: Codable {
    let id: String
    let name: String
    let avatarUrl: String?
}

// MARK: - Quote requests

enum QuoteStatus: String, Codable, CaseIterable, Identifiable {
    case pending = "PENDING"
    case quoted = "QUOTED"
    case declined = "DECLINED"
    case accepted = "ACCEPTED"
    case withdrawn = "WITHDRAWN"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pending: return "Pending"
        case .quoted: return "Quoted"
        case .declined: return "Declined"
        case .accepted: return "Accepted"
        case .withdrawn: return "Withdrawn"
        }
    }

    var systemImage: String {
        switch self {
        case .pending: return "hourglass"
        case .quoted: return "dollarsign.circle.fill"
        case .declined: return "xmark.circle.fill"
        case .accepted: return "checkmark.seal.fill"
        case .withdrawn: return "slash.circle.fill"
        }
    }

    /// Whether this is a settled, terminal state.
    var isClosed: Bool {
        self == .accepted || self == .declined || self == .withdrawn
    }
}

/// A homeowner's structured project brief sent to a contractor, plus the
/// contractor's eventual quote.
struct QuoteRequest: Codable, Identifiable {
    let id: String
    let clientId: String
    let businessId: String
    let category: String?
    let description: String
    let budgetMin: Int?
    let budgetMax: Int?
    let timeline: String?
    let imageUrls: [String]
    var status: QuoteStatus
    var quoteLow: Int?
    var quoteHigh: Int?
    var responseNote: String?
    var respondedAt: String?
    let createdAt: String
    let business: BusinessSummary?
    let client: AppointmentClient?

    /// "$20,000 – $35,000", "From $20,000", "Up to $35,000", or nil.
    var budgetText: String? { Self.rangeText(budgetMin, budgetMax) }

    /// The contractor's quoted range, once provided.
    var quoteText: String? { Self.rangeText(quoteLow, quoteHigh) }

    static func rangeText(_ lo: Int?, _ hi: Int?) -> String? {
        switch (lo, hi) {
        case let (l?, h?): return "$\(l.formatted()) – $\(h.formatted())"
        case let (l?, nil): return "From $\(l.formatted())"
        case let (nil, h?): return "Up to $\(h.formatted())"
        default: return nil
        }
    }
}

// MARK: - Activity feed

enum ActivityType: String, Codable {
    case lead = "LEAD"
    case message = "MESSAGE"
    case appointment = "APPOINTMENT"
    case review = "REVIEW"
    case savedSearch = "SAVED_SEARCH"
    // Future-proof: unknown server types decode to `.other` rather than failing.
    case other

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ActivityType(rawValue: raw) ?? .other
    }

    var systemImage: String {
        switch self {
        case .lead: return "person.2.fill"
        case .message: return "message.fill"
        case .appointment: return "calendar"
        case .review: return "star.fill"
        case .savedSearch: return "magnifyingglass"
        case .other: return "bell.fill"
        }
    }
}

/// Deep-link payload attached to an activity (whichever key applies).
struct ActivityData: Codable {
    let conversationId: String?
    let appointmentId: String?
    let businessId: String?
}

struct Activity: Codable, Identifiable {
    let id: String
    let type: ActivityType
    let title: String
    let body: String
    let data: ActivityData?
    let readAt: String?
    let createdAt: String

    var isUnread: Bool { readAt == nil }
}

struct DashboardStats: Codable {
    let profileViews: Int
    let averageRating: Double
    let reviewCount: Int
    let isPromoted: Bool
    let totalLeads: Int
    let conversationCount: Int
    let leadsByStatus: LeadsByStatus
    let conversionRate: Int
    let pipelineValue: Int
    let wonValue: Int
}

struct LeadsByStatus: Codable {
    let NEW: Int
    let CONTACTED: Int
    let CONVERTED: Int
    let CLOSED: Int

    func count(for status: LeadStatus) -> Int {
        switch status {
        case .new: return NEW
        case .contacted: return CONTACTED
        case .converted: return CONVERTED
        case .closed: return CLOSED
        }
    }
}
