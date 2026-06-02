import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case requestFailed(Int, String)
    case decodingFailed(Error)
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .requestFailed(let code, let msg): return "Request failed (\(code)): \(msg)"
        case .decodingFailed(let e): return "Decoding error: \(e.localizedDescription)"
        case .unauthorized: return "Session expired. Please log in again."
        }
    }
}

final class APIService {
    static let shared = APIService()

    // Simulator: http://localhost:3000
    // Physical device: use your Mac's local IP (must be on same WiFi)
    private let base = URL(string: "http://192.168.11.212:3000")!

    private var token: String? {
        UserDefaults.standard.string(forKey: "authToken")
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Encodable? = nil) async throws -> T {
        try await request(url: base.appendingPathComponent(path), method: method, body: body)
    }

    private func request<T: Decodable>(url: URL, method: String = "GET", body: Encodable? = nil) async throws -> T {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONEncoder().encode(body) }

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidURL }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "Unknown error"
            throw APIError.requestFailed(http.statusCode, msg)
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decodingFailed(error)
        }
    }

    /// For endpoints that return no body (e.g. 204 No Content). Performs the
    /// request and validates the status code without attempting to decode.
    private func requestNoContent(_ path: String, method: String = "GET", body: Encodable? = nil) async throws {
        var req = URLRequest(url: base.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try JSONEncoder().encode(body) }

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidURL }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "Unknown error"
            throw APIError.requestFailed(http.statusCode, msg)
        }
    }

    // Auth
    func login(email: String, password: String) async throws -> AuthResponse {
        try await request("auth/login", method: "POST", body: ["email": email, "password": password])
    }

    func register(email: String, password: String, name: String, role: UserRole) async throws -> AuthResponse {
        try await request("auth/register", method: "POST", body: ["email": email, "password": password, "name": name, "role": role.rawValue])
    }

    func me() async throws -> User {
        try await request("auth/me")
    }

    /// Update the current user's editable preferences (e.g. push notifications).
    func updateProfile(pushEnabled: Bool) async throws -> User {
        try await request("auth/me", method: "PATCH", body: ["pushEnabled": pushEnabled])
    }

    func appleSignIn(identityToken: String, givenName: String?, familyName: String?, email: String?) async throws -> AuthResponse {
        struct Body: Encodable {
            let identityToken: String
            let givenName: String?
            let familyName: String?
            let email: String?
        }
        return try await request("auth/apple", method: "POST",
                                 body: Body(identityToken: identityToken, givenName: givenName, familyName: familyName, email: email))
    }

    // Businesses
    func searchBusinesses(specialty: String? = nil, city: String? = nil, q: String? = nil, page: Int = 1) async throws -> BusinessSearchResponse {
        var comps = URLComponents(url: base.appendingPathComponent("businesses"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [.init(name: "page", value: "\(page)")]
        if let specialty { items.append(.init(name: "specialty", value: specialty)) }
        if let city { items.append(.init(name: "city", value: city)) }
        if let q { items.append(.init(name: "q", value: q)) }
        comps.queryItems = items
        guard let url = comps.url else { throw APIError.invalidURL }
        return try await request(url: url)
    }

    func getBusiness(id: String) async throws -> Business {
        try await request("businesses/\(id)")
    }

    // Business dashboard
    func dashboard() async throws -> DashboardStats {
        try await request("businesses/dashboard")
    }

    // Leads CRM
    func myLeads() async throws -> [Lead] {
        try await request("leads")
    }

    func updateLead(id: String, status: LeadStatus? = nil, notes: String? = nil, estimatedValue: Int? = nil) async throws -> Lead {
        struct Body: Encodable {
            let status: String?
            let notes: String?
            let estimatedValue: Int?
        }
        return try await request("leads/\(id)", method: "PATCH",
                                 body: Body(status: status?.rawValue, notes: notes, estimatedValue: estimatedValue))
    }

    // Portfolio
    func getPortfolio(businessId: String) async throws -> [PortfolioProject] {
        try await request("businesses/\(businessId)/portfolio")
    }

    func createPortfolioProject(businessId: String, title: String, description: String?, category: String?,
                                costMin: Int?, costMax: Int?, durationWeeks: Int?) async throws -> PortfolioProject {
        struct Body: Encodable {
            let title: String
            let description: String?
            let category: String?
            let costMin: Int?
            let costMax: Int?
            let durationWeeks: Int?
        }
        return try await request("businesses/\(businessId)/portfolio", method: "POST",
                                 body: Body(title: title, description: description, category: category,
                                            costMin: costMin, costMax: costMax, durationWeeks: durationWeeks))
    }

    func deletePortfolioProject(businessId: String, projectId: String) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await request("businesses/\(businessId)/portfolio/\(projectId)", method: "DELETE")
    }

    // Estimations
    func createEstimation(images: [Data], roomType: String?, description: String?) async throws -> Estimation {
        let url = base.appendingPathComponent("estimations")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func append(_ string: String) { body.append(string.data(using: .utf8)!) }

        for (i, img) in images.enumerated() {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"images\"; filename=\"img\(i).jpg\"\r\nContent-Type: image/jpeg\r\n\r\n")
            body.append(img)
            append("\r\n")
        }
        if let rt = roomType { append("--\(boundary)\r\nContent-Disposition: form-data; name=\"roomType\"\r\n\r\n\(rt)\r\n") }
        if let d = description { append("--\(boundary)\r\nContent-Disposition: form-data; name=\"description\"\r\n\r\n\(d)\r\n") }
        append("--\(boundary)--\r\n")
        req.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.requestFailed((response as? HTTPURLResponse)?.statusCode ?? 0, "Upload failed")
        }
        return try JSONDecoder().decode(Estimation.self, from: data)
    }

    func myEstimations() async throws -> [Estimation] {
        try await request("estimations")
    }

    // Messaging
    func myConversations() async throws -> [Conversation] {
        try await request("conversations")
    }

    func startConversation(businessId: String, message: String) async throws -> Conversation {
        try await request("conversations", method: "POST", body: ["businessId": businessId, "message": message])
    }

    func getMessages(conversationId: String) async throws -> [ChatMessage] {
        try await request("conversations/\(conversationId)/messages")
    }

    func sendMessage(conversationId: String, body: String) async throws -> ChatMessage {
        try await request("conversations/\(conversationId)/messages", method: "POST", body: ["body": body])
    }

    /// Marks a conversation read for the current user (clears its unread count).
    @discardableResult
    func markConversationRead(conversationId: String) async throws -> Bool {
        struct Resp: Decodable { let clientLastReadAt: String?; let businessLastReadAt: String? }
        let _: Resp = try await request("conversations/\(conversationId)/read", method: "POST")
        return true
    }

    /// Total unread messages across all conversations — used for the inbox tab badge.
    func unreadCount() async throws -> Int {
        struct Resp: Decodable { let count: Int }
        let resp: Resp = try await request("conversations/unread")
        return resp.count
    }

    // Push notifications
    @discardableResult
    func registerDevice(token: String, platform: String = "ios") async throws -> Bool {
        struct Resp: Decodable { let id: String; let token: String; let platform: String }
        let _: Resp = try await request("devices", method: "POST", body: ["token": token, "platform": platform])
        return true
    }

    func unregisterDevice(token: String) async throws {
        try await requestNoContent("devices/\(token)", method: "DELETE")
    }

    // AI Chat
    func chat(message: String, history: [[String: String]]) async throws -> String {
        struct Body: Encodable { let message: String; let history: [[String: String]] }
        struct Resp: Decodable { let reply: String }
        let resp: Resp = try await request("chat", method: "POST", body: Body(message: message, history: history))
        return resp.reply
    }
}

