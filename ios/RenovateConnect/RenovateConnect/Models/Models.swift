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

/// Admin approval lifecycle for business listings and portfolio projects.
/// New self-service submissions start `.pending` and are hidden from public
/// search until an admin approves. `.rejected` carries a reason for the owner.
enum ApprovalStatus: String, Codable {
    case pending = "PENDING"
    case approved = "APPROVED"
    case rejected = "REJECTED"

    var label: String {
        switch self {
        case .pending: return "Pending review"
        case .approved: return "Approved"
        case .rejected: return "Needs changes"
        }
    }

    var systemImage: String {
        switch self {
        case .pending: return "clock.badge.questionmark"
        case .approved: return "checkmark.seal.fill"
        case .rejected: return "exclamationmark.triangle.fill"
        }
    }
}

struct Business: Codable, Identifiable {
    let id: String
    let companyName: String
    let description: String
    let logoUrl: String?
    let city: String
    let state: String
    // Present on owner/admin payloads (full business row); omitted from the lean
    // public/search projections.
    var zipCode: String?
    var address: String?
    let specialties: [String]
    let averageRating: Double
    let reviewCount: Int
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
    // Whether the contractor can accept in-app deposits (Stripe Connect payouts).
    var payoutsEnabled: Bool?

    // Admin approval — optional because the backend only includes these for
    // owners/admins and on dashboard payloads.
    var approvalStatus: ApprovalStatus?
    var rejectionReason: String?

    // Public shareable profile URL (server-provided on the detail payload).
    var shareUrl: String?

    // Geocoded location (set from the contractor's address) + distance from the
    // viewer when searching "near me" (server-computed, only present then).
    var lat: Double?
    var lng: Double?
    var distanceMiles: Double?

    // Set on businesses returned in the search "sponsored" array (Pro placement).
    var sponsored: Bool?

    var isVerified: Bool { verified ?? false }

    /// Short distance label for cards, e.g. "0.8 mi" / "12 mi" / "Nearby".
    var distanceText: String? {
        guard let distanceMiles else { return nil }
        if distanceMiles < 0.1 { return "Nearby" }
        return distanceMiles < 10
            ? String(format: "%.1f mi", distanceMiles)
            : "\(Int(distanceMiles.rounded())) mi"
    }

    /// The link a contractor shares (site/IG/cards) to send customers to their
    /// profile. Prefers the server value; falls back to the canonical format so
    /// it works even on lean payloads (e.g. the owner's own `currentUser`).
    var shareLink: URL {
        if let shareUrl, let url = URL(string: shareUrl) { return url }
        return URL(string: "https://renovateconnect.app/b/\(id)")!
    }
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
    var clientId: String?
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
    // Present on quote payloads: whether the contractor can accept in-app
    // deposits. Optional because other endpoints don't select it.
    let payoutsEnabled: Bool?
    // Owner user id — present on conversation payloads so the homeowner can
    // block the contractor's owner from the thread view. Optional elsewhere.
    var userId: String?
}

/// One entry from GET /blocks — a user the current user has blocked.
struct BlockedUser: Codable, Identifiable {
    let id: String
    let blockerId: String
    let blockedId: String
    let createdAt: String
    let blocked: BlockedUserSummary
}

struct BlockedUserSummary: Codable {
    let id: String
    let name: String
    let avatarUrl: String?
}

/// A submitted report (server returns the row on POST /reports).
struct ReportRecord: Codable, Identifiable {
    let id: String
    let targetType: String
    let targetId: String
    let reason: String
    let status: String
    let createdAt: String
}

// MARK: - Verification documents

enum VerificationDocType: String, Codable, CaseIterable, Identifiable {
    case license   = "LICENSE"
    case insurance = "INSURANCE"
    case identity  = "IDENTITY"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .license: return "Business license"
        case .insurance: return "Insurance certificate"
        case .identity: return "Government ID"
        }
    }

    var helperCopy: String {
        switch self {
        case .license:
            return "A state, county, or city contractor's license. PDF or photo."
        case .insurance:
            return "Liability or workers' comp certificate of insurance. Include the expiration date."
        case .identity:
            return "Optional. A driver's license or passport speeds up review."
        }
    }
}

enum VerificationDocStatus: String, Codable {
    case pending  = "PENDING"
    case approved = "APPROVED"
    case rejected = "REJECTED"

    var label: String {
        switch self {
        case .pending: return "Under review"
        case .approved: return "Approved"
        case .rejected: return "Needs attention"
        }
    }

    var systemImage: String {
        switch self {
        case .pending: return "clock.fill"
        case .approved: return "checkmark.seal.fill"
        case .rejected: return "exclamationmark.triangle.fill"
        }
    }
}

struct VerificationDocument: Codable, Identifiable {
    let id: String
    let type: VerificationDocType
    let fileUrl: String
    let documentNumber: String?
    let issuer: String?
    let expiresAt: String?
    let status: VerificationDocStatus
    let rejectionReason: String?
    let createdAt: String
    let reviewedAt: String?
}

// MARK: - Inspiration feed

/// One photo in the Inspiration feed (GET /feed). Each is a contractor's real
/// project photo; tapping routes to that contractor.
struct FeedItem: Codable, Identifiable {
    let id: String
    let imageUrl: String
    let beforeImageUrl: String?
    let isBeforeAfter: Bool
    let category: String?
    let costMin: Int?
    let costMax: Int?
    let projectId: String
    let title: String
    let business: FeedBusiness

    var costText: String? {
        switch (costMin, costMax) {
        case let (lo?, hi?): return "$\(lo.formatted()) – $\(hi.formatted())"
        case let (lo?, nil): return "From $\(lo.formatted())"
        case let (nil, hi?): return "Up to $\(hi.formatted())"
        default: return nil
        }
    }
}

struct FeedBusiness: Codable {
    let id: String
    let companyName: String
    let logoUrl: String?
    let city: String
    let state: String
    let verified: Bool?
    var isVerified: Bool { verified ?? false }
}

struct FeedResponse: Codable {
    let items: [FeedItem]
    let page: Int
    let limit: Int
    let hasMore: Bool
}

struct ChatMessage: Codable, Identifiable {
    let id: String
    let conversationId: String
    let senderId: String
    let body: String
    var imageUrls: [String]?
    let createdAt: String

    var images: [String] { imageUrls ?? [] }
    var hasText: Bool { !body.isEmpty }
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
    // Clearly-labeled Pro placements shown above organic results (page 1).
    var sponsored: [Business]?
}

/// Contractor "Pro" subscription state (GET /payments/pro/status).
struct ProStatus: Codable {
    let isPro: Bool
    var plan: String?
    var hasInsights: Bool?
    let status: String?
    let trialEndsAt: String?
    let currentPeriodEnd: String?

    var isTrialing: Bool { status == "trialing" }
    var insights: Bool { hasInsights ?? false }
}

/// Aggregated, de-identified market demand for the Pro Insights tier
/// (GET /payments/pro/insights). Never contains homeowner PII.
struct ProInsights: Codable {
    let demandByCategory: [DemandBucket]
    let demandByProjectType: [DemandBucket]
    let demandByArea: [DemandBucket]
    let minBucket: Int
    let performance: InsightsPerformance
}

struct DemandBucket: Codable, Identifiable {
    let label: String
    let count: Int
    var id: String { label }
}

struct InsightsPerformance: Codable {
    let profileViews: Int
    let searchImpressions: Int
    let totalLeads: Int
    let conversionRate: Int
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
    var beforeImageUrls: [String]?
    let featured: Bool

    // Admin approval — optional because the public API only includes it for
    // the owner and admins (public viewers get only APPROVED rows back).
    var approvalStatus: ApprovalStatus?
    var rejectionReason: String?

    // Business names alongside pending projects in the admin queue. Optional —
    // only populated by GET /admin/pending; nil elsewhere.
    var business: AdminPendingBusinessRef?

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
    /// The deposit tied to this quote, if one has been started/paid.
    let payment: QuotePayment?

    /// Whether a deposit has already been paid for this quote.
    var depositPaid: Bool { payment?.status == .succeeded }

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

/// The deposit attached to a quote (status only), used to flip the quote card
/// to a "Deposit paid" state. Mirrors the `payment` include on a quote.
struct QuotePayment: Codable {
    let status: PaymentStatus
}

// MARK: - Activity feed

enum ActivityType: String, Codable {
    case lead = "LEAD"
    case message = "MESSAGE"
    case appointment = "APPOINTMENT"
    case review = "REVIEW"
    case savedSearch = "SAVED_SEARCH"
    case payment = "PAYMENT"
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
        case .payment: return "dollarsign.circle.fill"
        case .other: return "bell.fill"
        }
    }
}

/// Deep-link payload attached to an activity (whichever key applies).
struct ActivityData: Codable {
    let conversationId: String?
    let appointmentId: String?
    let quoteId: String?
    let businessId: String?
}

/// Normalized deep-link descriptor the API computes for each activity (and
/// attaches to push payloads). Mirrors the backend `deepLinkFor` result: a
/// single { screen, id } the client routes on directly, instead of sniffing the
/// optional id keys inside `data`.
struct DeepLink: Codable, Equatable, Identifiable {
    enum Screen: String, Codable {
        case conversation, appointment, quote, business
        // Opens the review composer for a contractor (id == businessId), used by
        // the post-release "leave a review" nudge.
        case review
        // A saved web estimate (id == share code) — the estimator handoff.
        case savedEstimate
        // Forward-compat: unknown server screens decode to `.other`.
        case other

        init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Screen(rawValue: raw) ?? .other
        }
    }

    let screen: Screen
    let id: String

    /// Build a link from a raw push `userInfo` blob, using the same key
    /// priority as the backend (`conversationId` → `quoteId` → `appointmentId`
    /// → `businessId`). Returns nil when nothing actionable is present.
    init?(userInfo: [AnyHashable: Any]) {
        // A review nudge carries businessId plus prompt == "review"; route it to
        // the composer rather than the plain business profile.
        if (userInfo["prompt"] as? String) == "review", let id = userInfo["businessId"] as? String {
            self.screen = .review; self.id = id
        } else if let id = userInfo["conversationId"] as? String {
            self.screen = .conversation; self.id = id
        } else if let id = userInfo["quoteId"] as? String {
            self.screen = .quote; self.id = id
        } else if let id = userInfo["appointmentId"] as? String {
            self.screen = .appointment; self.id = id
        } else if let id = userInfo["businessId"] as? String {
            self.screen = .business; self.id = id
        } else {
            return nil
        }
    }

    init(screen: Screen, id: String) {
        self.screen = screen
        self.id = id
    }

    /// Build a link from an incoming universal link (e.g. the contractor share
    /// URL `https://renovateconnect.app/b/<id>`). Returns nil for paths we don't
    /// route. Mirrors the web routes in `web/app`.
    init?(webURL url: URL) {
        let parts = url.pathComponents.filter { $0 != "/" }
        // /b/<id> → contractor profile
        if parts.count == 2, parts[0] == "b" {
            self.screen = .business
            self.id = parts[1]
            return
        }
        // /e/<code> → saved web estimate (handoff)
        if parts.count == 2, parts[0] == "e" {
            self.screen = .savedEstimate
            self.id = parts[1]
            return
        }
        return nil
    }
}

struct Activity: Codable, Identifiable {
    let id: String
    let type: ActivityType
    let title: String
    let body: String
    let data: ActivityData?
    let link: DeepLink?
    let readAt: String?
    let createdAt: String

    var isUnread: Bool { readAt == nil }
}

// MARK: - Favorites digest ("what's new with your saved contractors")

struct DigestProject: Codable, Identifiable {
    let id: String
    let title: String
    let category: String?
    let imageUrls: [String]
    let createdAt: String
}

struct DigestReview: Codable, Identifiable {
    let id: String
    let rating: Int
    let body: String?
    let authorName: String
    let createdAt: String
}

/// One saved contractor's slice of the digest: what's appeared since the
/// homeowner last looked. `business` is a compact header summary.
struct FavoritesDigestEntry: Codable, Identifiable {
    struct Business: Codable {
        let id: String
        let companyName: String
        let logoUrl: String?
        let city: String
        let state: String
        let averageRating: Double
        let reviewCount: Int
        let verified: Bool?
        var isVerified: Bool { verified ?? false }
    }

    let business: Business
    let since: String
    let newProjectCount: Int
    let newReviewCount: Int
    let newProjects: [DigestProject]
    let newReviews: [DigestReview]
    let latestAt: String?
    let hasUpdates: Bool

    var id: String { business.id }

    /// "2 new projects · 1 new review" — empty when nothing is new.
    var headline: String {
        var parts: [String] = []
        if newProjectCount > 0 {
            parts.append("\(newProjectCount) new project\(newProjectCount == 1 ? "" : "s")")
        }
        if newReviewCount > 0 {
            parts.append("\(newReviewCount) new review\(newReviewCount == 1 ? "" : "s")")
        }
        return parts.joined(separator: " · ")
    }
}

/// Badge counts for the favorites digest entry point.
struct FavoritesDigestUnseen: Codable {
    let businesses: Int
    let items: Int
}

struct DashboardStats: Codable {
    let searchImpressions: Int
    let profileViews: Int
    let averageRating: Double
    let reviewCount: Int
    let totalLeads: Int
    let conversationCount: Int
    let leadsByStatus: LeadsByStatus
    let conversionRate: Int
    let pipelineValue: Int
    let wonValue: Int
}

// MARK: - In-app deposits (Stripe Connect)

/// A contractor's payout readiness. Mirrors GET /payments/connect/status.
/// `payoutsEnabled` gates whether homeowners can pay deposits to this business.
struct ConnectStatus: Codable {
    let onboarded: Bool
    let chargesEnabled: Bool
    let payoutsEnabled: Bool
}

/// The response to GET /payments/earnings — the contractor's money at a glance.
/// `releasedCents` is what's settled to them (deposit nets + approved
/// milestones); `inEscrowCents` is milestone funds held until release.
struct Earnings: Codable {
    let releasedCents: Int
    let inEscrowCents: Int
    let lifetimeFeesCents: Int
    let refundedCents: Int
    let releasedCount: Int
    let inEscrowCount: Int
}

/// The response to POST /payments/deposit — a hosted Checkout URL plus the
/// amount breakdown so the UI can confirm the figures before opening the page.
struct DepositCheckout: Codable {
    let paymentId: String
    let url: String
    let amountCents: Int
    let depositCents: Int
    let commissionCents: Int
}

enum PaymentStatus: String, Codable {
    case pending = "PENDING"
    case succeeded = "SUCCEEDED"
    case failed = "FAILED"
    case refunded = "REFUNDED"

    var label: String {
        switch self {
        case .pending:   return "Pending"
        case .succeeded: return "Paid"
        case .failed:    return "Failed"
        case .refunded:  return "Refunded"
        }
    }
}

/// A deposit payment row, as returned by GET /payments (role-scoped history).
struct Payment: Codable, Identifiable {
    let id: String
    let amountCents: Int
    let commissionCents: Int
    let status: PaymentStatus
    let description: String?
    let paidAt: String?
    let createdAt: String?
    let business: PaymentBusiness?
    let client: PaymentClient?

    struct PaymentBusiness: Codable {
        let id: String
        let companyName: String
        let logoUrl: String?
    }
    struct PaymentClient: Codable {
        let id: String
        let name: String
    }
}

// MARK: - Admin approval queue

/// Owner contact info embedded with each pending business in the admin queue,
/// so the admin can reach out before approving/rejecting.
struct AdminBusinessOwner: Codable {
    let id: String
    let name: String
    let email: String
}

/// Light-weight business reference attached to pending portfolio projects so
/// the admin queue can label which contractor a draft belongs to.
struct AdminPendingBusinessRef: Codable {
    let id: String
    let companyName: String
}

/// What an admin sees in the queue: businesses awaiting first approval and
/// portfolio projects awaiting first approval, side by side.
struct AdminPendingQueue: Codable {
    struct PendingBusiness: Codable, Identifiable {
        let id: String
        let companyName: String
        let description: String
        let city: String
        let state: String
        let createdAt: String
        let user: AdminBusinessOwner
        let approvalStatus: ApprovalStatus
    }
    let businesses: [PendingBusiness]
    let projects: [PortfolioProject]
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
