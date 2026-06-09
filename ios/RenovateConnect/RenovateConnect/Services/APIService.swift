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
        // Stored in the Keychain (encrypted), not UserDefaults. See Keychain.swift.
        AuthToken.value
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

    /// Update the current user's display name.
    func updateName(_ name: String) async throws -> User {
        try await request("auth/me", method: "PATCH", body: ["name": name])
    }

    /// Upload a new profile picture (single JPEG). Returns the refreshed user
    /// with its updated `avatarUrl`.
    func uploadAvatar(_ image: Data) async throws -> User {
        let url = base.appendingPathComponent("auth/me/avatar")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func append(_ s: String) { body.append(s.data(using: .utf8)!) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"avatar.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n")
        body.append(image)
        append("\r\n--\(boundary)--\r\n")
        req.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.requestFailed((response as? HTTPURLResponse)?.statusCode ?? 0, "Upload failed")
        }
        return try JSONDecoder().decode(User.self, from: data)
    }

    /// Permanently delete the current user's account. Irreversible.
    func deleteAccount() async throws {
        try await requestNoContent("auth/me", method: "DELETE")
    }

    /// Update per-category notification preferences. Only non-nil fields are
    /// sent, so a single toggle PATCHes just that category.
    func updateNotificationPrefs(notifyLeads: Bool? = nil,
                                 notifyMessages: Bool? = nil,
                                 notifyAppointments: Bool? = nil,
                                 notifyReviews: Bool? = nil) async throws -> User {
        struct Body: Encodable {
            let notifyLeads: Bool?
            let notifyMessages: Bool?
            let notifyAppointments: Bool?
            let notifyReviews: Bool?
        }
        return try await request("auth/me", method: "PATCH",
                                 body: Body(notifyLeads: notifyLeads,
                                            notifyMessages: notifyMessages,
                                            notifyAppointments: notifyAppointments,
                                            notifyReviews: notifyReviews))
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
    func searchBusinesses(specialty: String? = nil, city: String? = nil, q: String? = nil, page: Int = 1,
                          lat: Double? = nil, lng: Double? = nil, radiusMiles: Double? = nil) async throws -> BusinessSearchResponse {
        var comps = URLComponents(url: base.appendingPathComponent("businesses"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [.init(name: "page", value: "\(page)")]
        if let specialty { items.append(.init(name: "specialty", value: specialty)) }
        if let city { items.append(.init(name: "city", value: city)) }
        if let q { items.append(.init(name: "q", value: q)) }
        // "Near me": viewer coordinates make the API rank by distance.
        if let lat, let lng {
            items.append(.init(name: "lat", value: "\(lat)"))
            items.append(.init(name: "lng", value: "\(lng)"))
            if let radiusMiles { items.append(.init(name: "radiusMiles", value: "\(radiusMiles)")) }
        }
        comps.queryItems = items
        guard let url = comps.url else { throw APIError.invalidURL }
        return try await request(url: url)
    }

    func getBusiness(id: String) async throws -> Business {
        try await request("businesses/\(id)")
    }

    /// Public Inspiration feed of contractor project photos.
    func feed(page: Int = 1, category: String? = nil) async throws -> FeedResponse {
        var comps = URLComponents(url: base.appendingPathComponent("feed"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [.init(name: "page", value: "\(page)")]
        if let category { items.append(.init(name: "category", value: category)) }
        comps.queryItems = items
        guard let url = comps.url else { throw APIError.invalidURL }
        return try await request(url: url)
    }

    /// Upload before/after photos to a portfolio project (`type` = before/after).
    func uploadPortfolioImages(businessId: String, projectId: String, images: [Data], type: String) async throws -> PortfolioProject {
        let url = base.appendingPathComponent("businesses/\(businessId)/portfolio/\(projectId)/images")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var payload = Data()
        func append(_ s: String) { payload.append(s.data(using: .utf8)!) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\n\(type)\r\n")
        for (i, img) in images.enumerated() {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"images\"; filename=\"img\(i).jpg\"\r\nContent-Type: image/jpeg\r\n\r\n")
            payload.append(img)
            append("\r\n")
        }
        append("--\(boundary)--\r\n")
        req.httpBody = payload
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.requestFailed((response as? HTTPURLResponse)?.statusCode ?? 0, "Upload failed")
        }
        return try JSONDecoder().decode(PortfolioProject.self, from: data)
    }

    /// Create the signed-in contractor's business profile. Optional fields left
    /// nil are omitted from the request so server-side validation (e.g. the URL
    /// check on `website`) only runs on values the user actually provided.
    func createBusiness(companyName: String, description: String, city: String, state: String,
                        zipCode: String, specialties: [String], yearsInBusiness: Int?,
                        licenseNumber: String?, website: String?, address: String?,
                        lat: Double? = nil, lng: Double? = nil) async throws -> Business {
        struct Body: Encodable {
            let companyName: String
            let description: String
            let city: String
            let state: String
            let zipCode: String
            let specialties: [String]
            let yearsInBusiness: Int?
            let licenseNumber: String?
            let website: String?
            let address: String?
            let lat: Double?
            let lng: Double?
        }
        return try await request("businesses", method: "POST",
                                 body: Body(companyName: companyName, description: description,
                                            city: city, state: state, zipCode: zipCode,
                                            specialties: specialties, yearsInBusiness: yearsInBusiness,
                                            licenseNumber: licenseNumber, website: website, address: address,
                                            lat: lat, lng: lng))
    }

    func updateBusiness(id: String, companyName: String, description: String, city: String, state: String,
                        zipCode: String, specialties: [String], yearsInBusiness: Int?,
                        licenseNumber: String?, website: String?, address: String?,
                        lat: Double? = nil, lng: Double? = nil) async throws -> Business {
        struct Body: Encodable {
            let companyName: String
            let description: String
            let city: String
            let state: String
            let zipCode: String
            let specialties: [String]
            let yearsInBusiness: Int?
            let licenseNumber: String?
            let website: String?
            let address: String?
            let lat: Double?
            let lng: Double?
        }
        return try await request("businesses/\(id)", method: "PUT",
                                 body: Body(companyName: companyName, description: description,
                                            city: city, state: state, zipCode: zipCode,
                                            specialties: specialties, yearsInBusiness: yearsInBusiness,
                                            licenseNumber: licenseNumber, website: website, address: address,
                                            lat: lat, lng: lng))
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

    func updatePortfolioProject(businessId: String, projectId: String,
                                title: String, description: String?, category: String?,
                                costMin: Int?, costMax: Int?, durationWeeks: Int?) async throws -> PortfolioProject {
        struct Body: Encodable {
            let title: String
            let description: String?
            let category: String?
            let costMin: Int?
            let costMax: Int?
            let durationWeeks: Int?
        }
        return try await request("businesses/\(businessId)/portfolio/\(projectId)", method: "PUT",
                                 body: Body(title: title, description: description, category: category,
                                            costMin: costMin, costMax: costMax, durationWeeks: durationWeeks))
    }

    func deletePortfolioProject(businessId: String, projectId: String) async throws {
        struct Empty: Decodable {}
        let _: Empty = try await request("businesses/\(businessId)/portfolio/\(projectId)", method: "DELETE")
    }

    /// Upload one or more JPEG photos to a portfolio project. They're appended
    /// to the project's `imageUrls` array on the server; the updated project
    /// is returned so the UI can rebind without a separate fetch.
    func uploadPortfolioImages(businessId: String, projectId: String, images: [Data]) async throws -> PortfolioProject {
        let url = base.appendingPathComponent("businesses/\(businessId)/portfolio/\(projectId)/images")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func append(_ s: String) { body.append(s.data(using: .utf8)!) }
        for (i, img) in images.enumerated() {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"images\"; filename=\"img\(i).jpg\"\r\nContent-Type: image/jpeg\r\n\r\n")
            body.append(img)
            append("\r\n")
        }
        append("--\(boundary)--\r\n")
        req.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.requestFailed((response as? HTTPURLResponse)?.statusCode ?? 0, "Upload failed")
        }
        return try JSONDecoder().decode(PortfolioProject.self, from: data)
    }

    /// Remove a single image (identified by URL) from a portfolio project.
    /// Idempotent — removing a URL that isn't on the project is a no-op.
    func deletePortfolioImage(businessId: String, projectId: String, url: String) async throws -> PortfolioProject {
        try await request("businesses/\(businessId)/portfolio/\(projectId)/images",
                          method: "DELETE", body: ["url": url])
    }

    // Admin approval queue
    func adminPending() async throws -> AdminPendingQueue {
        try await request("admin/pending")
    }

    func adminApproveBusiness(id: String) async throws -> Business {
        struct Empty: Encodable {}
        return try await request("admin/businesses/\(id)/approve", method: "POST", body: Empty())
    }

    func adminRejectBusiness(id: String, reason: String?) async throws -> Business {
        try await request("admin/businesses/\(id)/reject", method: "POST",
                          body: ["reason": reason ?? ""])
    }

    /// Admin: grant or revoke the "Verified by RenovateConnect" trust badge,
    /// which also sorts the business ahead of unverified ones in search.
    func adminVerifyBusiness(id: String, verified: Bool) async throws -> Business {
        try await request("businesses/\(id)/verify", method: "PATCH",
                          body: ["verified": verified])
    }

    func adminApprovePortfolio(projectId: String) async throws -> PortfolioProject {
        struct Empty: Encodable {}
        return try await request("admin/portfolio/\(projectId)/approve", method: "POST", body: Empty())
    }

    func adminRejectPortfolio(projectId: String, reason: String?) async throws -> PortfolioProject {
        try await request("admin/portfolio/\(projectId)/reject", method: "POST",
                          body: ["reason": reason ?? ""])
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

    /// Guest (signed-out) estimate. Hits the public endpoint that runs the AI but
    /// persists nothing, and returns just the result. The caller wraps it in a
    /// throwaway Estimation so the same result UI can render it.
    func guestEstimation(images: [Data], roomType: String?, description: String?) async throws -> EstimationResult {
        let url = base.appendingPathComponent("estimations/guest")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"

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
            throw APIError.requestFailed((response as? HTTPURLResponse)?.statusCode ?? 0, "Estimate failed")
        }
        struct GuestEstimationResponse: Decodable { let result: EstimationResult }
        return try JSONDecoder().decode(GuestEstimationResponse.self, from: data).result
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

    /// Fetch a single conversation including both participants' read timestamps,
    /// so the thread view can show whether the other party has seen your message.
    func getConversation(id: String) async throws -> Conversation {
        try await request("conversations/\(id)")
    }

    func sendMessage(conversationId: String, body: String) async throws -> ChatMessage {
        try await request("conversations/\(conversationId)/messages", method: "POST", body: ["body": body])
    }

    /// Send a message with one or more photo attachments (and optional text) via
    /// multipart. The server stores the images and returns the created message.
    func sendMessage(conversationId: String, body: String, images: [Data]) async throws -> ChatMessage {
        let url = base.appendingPathComponent("conversations/\(conversationId)/messages")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var payload = Data()
        func append(_ s: String) { payload.append(s.data(using: .utf8)!) }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"body\"\r\n\r\n\(trimmed)\r\n")
        }
        for (i, img) in images.enumerated() {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"images\"; filename=\"img\(i).jpg\"\r\nContent-Type: image/jpeg\r\n\r\n")
            payload.append(img)
            append("\r\n")
        }
        append("--\(boundary)--\r\n")
        req.httpBody = payload

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.requestFailed((response as? HTTPURLResponse)?.statusCode ?? 0, "Send failed")
        }
        return try JSONDecoder().decode(ChatMessage.self, from: data)
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

    // Saved contractors (favorites)
    func myFavorites() async throws -> [Business] {
        try await request("favorites")
    }

    @discardableResult
    func saveFavorite(businessId: String) async throws -> Bool {
        struct Resp: Decodable { let id: String; let businessId: String }
        let _: Resp = try await request("favorites/\(businessId)", method: "POST")
        return true
    }

    func removeFavorite(businessId: String) async throws {
        try await requestNoContent("favorites/\(businessId)", method: "DELETE")
    }

    // Favorites digest — "what's new with your saved contractors".
    func favoritesDigest() async throws -> [FavoritesDigestEntry] {
        try await request("favorites/digest")
    }

    func favoritesDigestUnseen() async throws -> FavoritesDigestUnseen {
        try await request("favorites/digest/unseen")
    }

    @discardableResult
    func markFavoritesDigestSeen() async throws -> Bool {
        struct Resp: Decodable { let seenAt: String }
        let _: Resp = try await request("favorites/digest/seen", method: "POST")
        return true
    }

    // Saved searches (alerts on new matching contractors)
    func mySavedSearches() async throws -> [SavedSearch] {
        try await request("saved-searches")
    }

    func createSavedSearch(name: String? = nil, specialty: String? = nil,
                           city: String? = nil, state: String? = nil,
                           q: String? = nil) async throws -> SavedSearch {
        struct Body: Encodable {
            let name: String?
            let specialty: String?
            let city: String?
            let state: String?
            let q: String?
        }
        return try await request("saved-searches", method: "POST",
                                 body: Body(name: name, specialty: specialty, city: city, state: state, q: q))
    }

    func deleteSavedSearch(id: String) async throws {
        try await requestNoContent("saved-searches/\(id)", method: "DELETE")
    }

    // Appointments
    func myAppointments() async throws -> [Appointment] {
        try await request("appointments")
    }

    func requestAppointment(businessId: String, scheduledAt: Date, durationMin: Int? = nil, note: String? = nil) async throws -> Appointment {
        struct Body: Encodable {
            let businessId: String
            let scheduledAt: String
            let durationMin: Int?
            let note: String?
        }
        let iso = ISO8601DateFormatter().string(from: scheduledAt)
        return try await request("appointments", method: "POST",
                                 body: Body(businessId: businessId, scheduledAt: iso, durationMin: durationMin, note: note))
    }

    func updateAppointment(id: String, status: AppointmentStatus) async throws -> Appointment {
        try await request("appointments/\(id)", method: "PATCH", body: ["status": status.rawValue])
    }

    // Business hours (weekly recurring open hours)
    func businessHours(businessId: String) async throws -> [BusinessHours] {
        try await request("businesses/\(businessId)/hours")
    }

    /// Owner: replace the full week of hours. Send `closed: true` for days off.
    @discardableResult
    func updateBusinessHours(businessId: String, hours: [BusinessHours]) async throws -> [BusinessHours] {
        struct Day: Encodable {
            let dayOfWeek: Int
            let openMinute: Int
            let closeMinute: Int
            let closed: Bool
        }
        struct Body: Encodable { let hours: [Day] }
        let body = Body(hours: hours.map {
            Day(dayOfWeek: $0.dayOfWeek, openMinute: $0.openMinute,
                closeMinute: $0.closeMinute, closed: $0.closed)
        })
        return try await request("businesses/\(businessId)/hours", method: "PUT", body: body)
    }

    // Quote requests (structured project briefs → contractor estimates)
    func myQuotes() async throws -> [QuoteRequest] {
        try await request("quotes")
    }

    func getQuote(id: String) async throws -> QuoteRequest {
        try await request("quotes/\(id)")
    }

    func createQuoteRequest(businessId: String, description: String, category: String? = nil,
                            budgetMin: Int? = nil, budgetMax: Int? = nil,
                            timeline: String? = nil, imageUrls: [String]? = nil) async throws -> QuoteRequest {
        struct Body: Encodable {
            let businessId: String
            let description: String
            let category: String?
            let budgetMin: Int?
            let budgetMax: Int?
            let timeline: String?
            let imageUrls: [String]?
        }
        return try await request("quotes", method: "POST",
                                 body: Body(businessId: businessId, description: description,
                                            category: category, budgetMin: budgetMin,
                                            budgetMax: budgetMax, timeline: timeline, imageUrls: imageUrls))
    }

    /// Drive a quote's lifecycle. Contractors send QUOTED (with prices) or
    /// DECLINED; homeowners send ACCEPTED or WITHDRAWN.
    @discardableResult
    func updateQuote(id: String, status: QuoteStatus, quoteLow: Int? = nil,
                     quoteHigh: Int? = nil, responseNote: String? = nil) async throws -> QuoteRequest {
        struct Body: Encodable {
            let status: String
            let quoteLow: Int?
            let quoteHigh: Int?
            let responseNote: String?
        }
        return try await request("quotes/\(id)", method: "PATCH",
                                 body: Body(status: status.rawValue, quoteLow: quoteLow,
                                            quoteHigh: quoteHigh, responseNote: responseNote))
    }

    // MARK: - Project hub (derived: everything tied to one contractor)

    /// Active projects for the signed-in user, grouped by contractor, newest
    /// activity first. Read-only aggregation over quotes/appointments/payments/
    /// messages — there's no Project table behind this.
    func myProjects() async throws -> [ProjectSummary] {
        try await request("projects")
    }

    /// The full aggregated timeline for one engagement (the homeowner's project
    /// with a given contractor).
    func project(businessId: String) async throws -> ProjectDetail {
        try await request("projects/\(businessId)")
    }

    /// Save the homeowner's project notes (free-form scratchpad). Pass an
    /// empty string to clear. Returns the persisted value.
    func updateProjectNotes(projectId: String, notes: String) async throws -> String? {
        struct Body: Encodable { let notes: String }
        struct Resp: Decodable { let clientNotes: String? }
        let resp: Resp = try await request("projects/\(projectId)/notes",
                                           method: "PATCH",
                                           body: Body(notes: notes))
        return resp.clientNotes
    }

    // MARK: - Milestone escrow

    /// Create (or fetch) the persistent Project for an accepted quote, so staged
    /// milestone payments can hang off it.
    func createProject(quoteRequestId: String) async throws -> ProjectRecord {
        try await request("projects", method: "POST", body: ["quoteRequestId": quoteRequestId])
    }

    /// Contractor: add a payment milestone to a project (amount in cents).
    func addMilestone(projectId: String, title: String, amountCents: Int) async throws -> Milestone {
        struct Body: Encodable { let title: String; let amountCents: Int }
        return try await request("projects/\(projectId)/milestones", method: "POST",
                                 body: Body(title: title, amountCents: amountCents))
    }

    /// Homeowner: fund a milestone. Returns a hosted Checkout URL to open in a
    /// Safari view; funds are held in escrow until release.
    func fundMilestone(projectId: String, milestoneId: String) async throws -> URL {
        struct Resp: Decodable { let url: String }
        let resp: Resp = try await request("projects/\(projectId)/milestones/\(milestoneId)/fund", method: "POST")
        guard let url = URL(string: resp.url) else { throw APIError.invalidURL }
        return url
    }

    /// Homeowner: release escrowed funds to the contractor.
    func approveMilestone(projectId: String, milestoneId: String) async throws -> Milestone {
        try await request("projects/\(projectId)/milestones/\(milestoneId)/approve", method: "POST")
    }

    /// Contractor: mark a funded milestone complete, attaching proof photos.
    func submitMilestone(projectId: String, milestoneId: String, images: [Data]) async throws -> Milestone {
        let url = base.appendingPathComponent("projects/\(projectId)/milestones/\(milestoneId)/submit")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func append(_ s: String) { body.append(s.data(using: .utf8)!) }
        for (i, img) in images.enumerated() {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"images\"; filename=\"proof\(i).jpg\"\r\nContent-Type: image/jpeg\r\n\r\n")
            body.append(img)
            append("\r\n")
        }
        append("--\(boundary)--\r\n")
        req.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.requestFailed((response as? HTTPURLResponse)?.statusCode ?? 0, "Submit failed")
        }
        return try JSONDecoder().decode(Milestone.self, from: data)
    }

    // Activity feed
    func myActivities() async throws -> [Activity] {
        try await request("activities")
    }

    func activitiesUnreadCount() async throws -> Int {
        struct Resp: Decodable { let count: Int }
        let resp: Resp = try await request("activities/unread")
        return resp.count
    }

    @discardableResult
    func markActivitiesRead() async throws -> Int {
        struct Resp: Decodable { let updated: Int }
        let resp: Resp = try await request("activities/read", method: "POST")
        return resp.updated
    }

    // Reviews
    @discardableResult
    func submitReview(businessId: String, rating: Int, body: String?) async throws -> Review {
        struct Body: Encodable {
            let businessId: String
            let rating: Int
            let body: String?
        }
        return try await request("reviews", method: "POST",
                                 body: Body(businessId: businessId, rating: rating, body: body))
    }

    /// The caller's own reviews, optionally scoped to one business so the UI
    /// can tell whether they've already reviewed it.
    func myReviews(businessId: String? = nil) async throws -> [Review] {
        struct Resp: Decodable { let reviews: [Review] }
        let path = businessId.map { "reviews/mine?businessId=\($0)" } ?? "reviews/mine"
        let resp: Resp = try await request(path)
        return resp.reviews
    }

    @discardableResult
    func updateReview(id: String, rating: Int? = nil, body: String? = nil) async throws -> Review {
        struct Body: Encodable { let rating: Int?; let body: String? }
        return try await request("reviews/\(id)", method: "PATCH",
                                 body: Body(rating: rating, body: body))
    }

    func deleteReview(id: String) async throws {
        try await requestNoContent("reviews/\(id)", method: "DELETE")
    }

    /// Business owner: publicly reply to (or edit the reply on) one of its reviews.
    @discardableResult
    func respondToReview(id: String, response: String) async throws -> Review {
        struct Body: Encodable { let response: String }
        return try await request("reviews/\(id)/response", method: "PUT", body: Body(response: response))
    }

    /// Business owner: remove its reply from a review.
    @discardableResult
    func deleteReviewResponse(id: String) async throws -> Review {
        try await request("reviews/\(id)/response", method: "DELETE")
    }

    // MARK: - In-app deposits (Stripe Connect)

    /// Business: start (or resume) Stripe Connect onboarding so the contractor
    /// can receive in-app deposit payouts. Returns the hosted onboarding URL.
    func connectOnboardURL() async throws -> URL {
        struct Resp: Decodable { let url: String }
        let resp: Resp = try await request("payments/connect/onboard", method: "POST")
        guard let url = URL(string: resp.url) else { throw APIError.invalidURL }
        return url
    }

    /// Business: current payout readiness (syncs the flags from Stripe).
    func connectStatus() async throws -> ConnectStatus {
        try await request("payments/connect/status")
    }

    /// Homeowner: start a hosted Checkout to pay the deposit on an accepted
    /// quote. Returns the breakdown plus the URL to open in a Safari view.
    func depositCheckout(quoteRequestId: String) async throws -> DepositCheckout {
        struct Body: Encodable { let quoteRequestId: String }
        return try await request("payments/deposit", method: "POST",
                                 body: Body(quoteRequestId: quoteRequestId))
    }

    /// Role-scoped deposit history (homeowner's payments / business's receipts).
    func payments() async throws -> [Payment] {
        try await request("payments")
    }

    /// Contractor: aggregate earnings — released vs. in-escrow, plus fees/refunds.
    func earnings() async throws -> Earnings {
        try await request("payments/earnings")
    }

    // MARK: - Pro subscription

    func proStatus() async throws -> ProStatus {
        try await request("payments/pro/status")
    }

    /// Start the Pro Checkout for the chosen tier and return the hosted URL.
    func proSubscribeURL(plan: String) async throws -> URL {
        struct Resp: Decodable { let url: String }
        let resp: Resp = try await request("payments/pro/subscribe", method: "POST", body: ["plan": plan])
        guard let url = URL(string: resp.url) else { throw APIError.invalidURL }
        return url
    }

    func cancelPro() async throws {
        try await requestNoContent("payments/pro/cancel", method: "POST")
    }

    /// Aggregated market insights (Insights tier only).
    func proInsights() async throws -> ProInsights {
        try await request("payments/pro/insights")
    }

    /// Fetch a web-saved estimate by its short code (the estimator handoff) and
    /// adapt it into an `Estimation` so the existing result view can render it.
    func sharedEstimate(code: String) async throws -> Estimation {
        struct Shared: Decodable {
            let code: String
            let roomType: String?
            let result: EstimationResult
            let createdAt: String
        }
        let normalized = code.uppercased().filter { $0.isLetter || $0.isNumber }
        let s: Shared = try await request("estimations/shared/\(normalized)")
        return Estimation(id: s.code, imageUrls: [], roomType: s.roomType,
                          description: nil, result: s.result, createdAt: s.createdAt)
    }

    /// Contractor (or admin): fully refund a settled deposit. Reverses the
    /// transfer and refunds the platform fee server-side; the row flips to
    /// REFUNDED via webhook, so callers should re-fetch after this returns.
    func refundPayment(id: String) async throws {
        try await requestNoContent("payments/\(id)/refund", method: "POST")
    }

    // AI Chat
    func chat(message: String, history: [[String: String]]) async throws -> (reply: String, mentioned: [BusinessRef]) {
        struct Body: Encodable { let message: String; let history: [[String: String]] }
        struct Resp: Decodable { let reply: String; let mentioned: [BusinessRef]? }
        let resp: Resp = try await request("chat", method: "POST", body: Body(message: message, history: history))
        return (resp.reply, resp.mentioned ?? [])
    }

    // MARK: - Reports & Blocks (App Store guideline 1.2 — UGC moderation)

    /// File a report on a user, message, review, portfolio item, feed photo,
    /// or business. Server-side queue is reviewed by admins.
    func report(targetType: String, targetId: String, reason: String, details: String?) async throws -> ReportRecord {
        struct Body: Encodable {
            let targetType: String
            let targetId: String
            let reason: String
            let details: String?
        }
        return try await request("reports", method: "POST",
                                 body: Body(targetType: targetType, targetId: targetId,
                                            reason: reason, details: details))
    }

    /// Block another user. Symmetric in effect — once blocked, neither side can
    /// message the other and shared threads disappear from both inboxes.
    func block(userId: String) async throws {
        struct Body: Encodable { let userId: String }
        _ = try await request("blocks", method: "POST", body: Body(userId: userId)) as BlockedUser
    }

    func unblock(userId: String) async throws {
        try await requestNoContent("blocks/\(userId)", method: "DELETE")
    }

    func blockedUsers() async throws -> [BlockedUser] {
        try await request("blocks")
    }

    // MARK: - Milestone disputes

    /// Open a dispute on a FUNDED or SUBMITTED milestone. Pauses the
    /// auto-release until the homeowner withdraws or an admin resolves.
    func disputeMilestone(projectId: String, milestoneId: String,
                          reason: String, details: String) async throws {
        struct Body: Encodable { let reason: String; let details: String }
        try await requestNoContent("projects/\(projectId)/milestones/\(milestoneId)/dispute",
                                   method: "POST",
                                   body: Body(reason: reason, details: details))
    }

    /// Withdraw the homeowner's own open dispute; the milestone falls back to
    /// its pre-dispute status (FUNDED or SUBMITTED).
    func withdrawDispute(projectId: String, milestoneId: String) async throws {
        try await requestNoContent("projects/\(projectId)/milestones/\(milestoneId)/dispute/withdraw",
                                   method: "POST")
    }

    // MARK: - Verification documents

    /// List the contractor's uploaded verification documents (owner or admin).
    func verificationDocuments(businessId: String) async throws -> [VerificationDocument] {
        try await request("businesses/\(businessId)/verification-documents")
    }

    /// Upload one verification document (PDF or image). `expiresAt` is an
    /// ISO-8601 string (e.g. "2027-04-30T00:00:00Z").
    func uploadVerificationDocument(businessId: String,
                                    fileData: Data,
                                    mimeType: String,
                                    filename: String,
                                    type: VerificationDocType,
                                    documentNumber: String?,
                                    issuer: String?,
                                    expiresAt: String?) async throws -> VerificationDocument {
        let url = base.appendingPathComponent("businesses/\(businessId)/verification-documents")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)",
                     forHTTPHeaderField: "Content-Type")

        var body = Data()
        func append(_ s: String) { body.append(s.data(using: .utf8)!) }
        func field(_ name: String, _ value: String) {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        field("type", type.rawValue)
        if let documentNumber, !documentNumber.isEmpty { field("documentNumber", documentNumber) }
        if let issuer,         !issuer.isEmpty         { field("issuer", issuer) }
        if let expiresAt,      !expiresAt.isEmpty      { field("expiresAt", expiresAt) }
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\nContent-Type: \(mimeType)\r\n\r\n")
        body.append(fileData)
        append("\r\n--\(boundary)--\r\n")
        req.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "Upload failed"
            throw APIError.requestFailed((response as? HTTPURLResponse)?.statusCode ?? 0, msg)
        }
        return try JSONDecoder().decode(VerificationDocument.self, from: data)
    }

    /// Withdraw a PENDING upload before it's reviewed.
    func deleteVerificationDocument(businessId: String, docId: String) async throws {
        try await requestNoContent("businesses/\(businessId)/verification-documents/\(docId)",
                                   method: "DELETE")
    }
}

