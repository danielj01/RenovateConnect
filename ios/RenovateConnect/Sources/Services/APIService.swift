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

    // Replace with your deployed API URL in production
    private let base = URL(string: "http://localhost:3000")!

    private var token: String? {
        UserDefaults.standard.string(forKey: "authToken")
    }

    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Encodable? = nil) async throws -> T {
        let url = base.appendingPathComponent(path)
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

    // Businesses
    func searchBusinesses(specialty: String? = nil, city: String? = nil, q: String? = nil, page: Int = 1) async throws -> BusinessSearchResponse {
        var comps = URLComponents(url: base.appendingPathComponent("businesses"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [.init(name: "page", value: "\(page)")]
        if let specialty { items.append(.init(name: "specialty", value: specialty)) }
        if let city { items.append(.init(name: "city", value: city)) }
        if let q { items.append(.init(name: "q", value: q)) }
        comps.queryItems = items
        let path = comps.url!.pathWithQuery
        return try await request(path)
    }

    func getBusiness(id: String) async throws -> Business {
        try await request("businesses/\(id)")
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

    // AI Chat
    func chat(message: String, history: [[String: String]]) async throws -> String {
        struct Resp: Decodable { let reply: String }
        let resp: Resp = try await request("chat", method: "POST", body: ["message": message, "history": history])
        return resp.reply
    }
}

private extension URL {
    var pathWithQuery: String {
        var s = path
        if let q = query { s += "?\(q)" }
        return s
    }
}
