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

    // Trust signals
    var verified: Bool?
    var verifiedAt: String?
    var licenseNumber: String?

    var isVerified: Bool { verified ?? false }
}

struct Review: Codable, Identifiable {
    let id: String
    let authorName: String
    let rating: Int
    let body: String?
    let createdAt: String
}

struct Conversation: Codable, Identifiable, Hashable {
    let id: String
    let businessId: String
    let business: BusinessSummary?
    let updatedAt: String
    let messages: [ChatMessage]?
    var unreadCount: Int?

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
