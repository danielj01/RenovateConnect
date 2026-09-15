import SwiftUI
import ImageIO

/// Immutable, eagerly decoded image pixels can safely cross task boundaries.
nonisolated final class InspirationDecodedImage: @unchecked Sendable {
    let image: CGImage
    var aspectRatio: CGFloat { CGFloat(image.width) / CGFloat(image.height) }
    var byteCount: Int { image.bytesPerRow * image.height }
    init(_ image: CGImage) { self.image = image }
}

/// NSCache is thread-safe and evicts decoded pixels under memory pressure.
private nonisolated final class InspirationImageCache: @unchecked Sendable {
    let images = NSCache<NSString, InspirationDecodedImage>()
    let ratios = NSCache<NSString, NSNumber>()
    init() {
        images.totalCostLimit = 64 * 1024 * 1024
        images.countLimit = 150
        ratios.countLimit = 2000
    }
}

actor InspirationImagePipeline {
    static let shared = InspirationImagePipeline()
    private nonisolated let cache = InspirationImageCache()
    private var inFlight: [String: Task<InspirationDecodedImage, Error>] = [:]
    private let session: URLSession

    init(session: URLSession? = nil) {
        if let session { self.session = session }
        else {
            let config = URLSessionConfiguration.default
            config.urlCache = .shared
            config.httpMaximumConnectionsPerHost = 4
            config.timeoutIntervalForRequest = 30
            self.session = URLSession(configuration: config)
        }
    }

    nonisolated private func key(_ url: String, _ pixelLimit: Int) -> String {
        "\(pixelLimit)|\(url)"
    }

    nonisolated func cachedImage(for url: String, pixelLimit: Int) -> InspirationDecodedImage? {
        cache.images.object(forKey: key(url, pixelLimit) as NSString)
    }

    nonisolated func cachedAspectRatio(for url: String) -> CGFloat? {
        cache.ratios.object(forKey: url as NSString).map { CGFloat($0.doubleValue) }
    }

    func image(for url: String, pixelLimit: Int) async throws -> InspirationDecodedImage {
        if let image = cachedImage(for: url, pixelLimit: pixelLimit) { return image }
        let key = key(url, pixelLimit)
        if let task = inFlight[key] { return try await task.value }
        let session = session
        // Download and ImageIO downsampling stay off the main actor. A photo
        // shown in multiple cards shares this task rather than decoding twice.
        let task = Task.detached(priority: .userInitiated) {
            guard let requestURL = URL(string: url), ["http", "https"].contains(requestURL.scheme) else {
                throw URLError(.badURL)
            }
            let (data, response) = try await session.data(from: requestURL)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
                throw URLError(.badServerResponse)
            }
            return try Self.decode(data, pixelLimit: pixelLimit)
        }
        inFlight[key] = task
        defer { inFlight[key] = nil }
        let decoded = try await task.value
        cache.images.setObject(decoded, forKey: key as NSString, cost: decoded.byteCount)
        cache.ratios.setObject(NSNumber(value: Double(decoded.aspectRatio)), forKey: url as NSString)
        return decoded
    }

    nonisolated static func decode(_ data: Data, pixelLimit: Int) throws -> InspirationDecodedImage {
        guard pixelLimit > 0,
              let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: pixelLimit,
              ] as CFDictionary) else { throw URLError(.cannotDecodeContentData) }
        return InspirationDecodedImage(image)
    }
}

/// Cached images are available on the first render, avoiding a placeholder and
/// a second masonry layout pass when a previously seen card re-enters view.
struct InspirationRemoteImage<Content: View>: View {
    let url: String?
    let pixelLimit: Int
    private let content: (AsyncImagePhase) -> Content
    @State private var loaded: InspirationDecodedImage?
    @State private var loadedURL: String?
    @State private var failedURL: String?

    init(url: String?, pixelLimit: Int, @ViewBuilder content: @escaping (AsyncImagePhase) -> Content) {
        self.url = url
        self.pixelLimit = pixelLimit
        self.content = content
    }

    private var phase: AsyncImagePhase {
        guard let url else { return .failure(URLError(.badURL)) }
        if let decoded = (loadedURL == url ? loaded : nil) ?? InspirationImagePipeline.shared.cachedImage(for: url, pixelLimit: pixelLimit) {
            return .success(Image(decorative: decoded.image, scale: 1))
        }
        if failedURL == url { return .failure(URLError(.cannotLoadFromNetwork)) }
        return .empty
    }

    var body: some View {
        content(phase)
            .onDisappear {
                // Off-screen cells release their strong reference; the bounded
                // shared cache decides which decoded images to retain.
                loaded = nil
                loadedURL = nil
            }
            .task(id: "\(pixelLimit)|\(url ?? "")") {
                guard let url else { return }
                failedURL = nil
                do {
                    let result = try await InspirationImagePipeline.shared.image(for: url, pixelLimit: pixelLimit)
                    guard !Task.isCancelled else { return }
                    loaded = result
                    loadedURL = url
                } catch {
                    guard !Task.isCancelled else { return }
                    failedURL = url
                }
            }
    }
}
