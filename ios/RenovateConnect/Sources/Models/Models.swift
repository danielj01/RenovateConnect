import Foundation

struct User: Codable, Identifiable {
    let id: String
    let email: String
    let name: String
    let role: UserRole
    let phone: String?
    let avatarUrl: String?
    let business: Business?
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
}

struct Review: Codable, Identifiable {
    let id: String
    let authorName: String
    let rating: Int
    let body: String?
    let createdAt: String
}

struct Conversation: Codable, Identifiable {
    let id: String
    let businessId: String
    let business: BusinessSummary?
    let updatedAt: String
    let messages: [ChatMessage]?
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
