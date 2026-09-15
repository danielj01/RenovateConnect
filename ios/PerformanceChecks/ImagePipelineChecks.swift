import Foundation
import ImageIO
import UniformTypeIdentifiers

private nonisolated final class FixtureProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var requestCount = 0
    nonisolated(unsafe) static var fixture = Data()
    static var count: Int { lock.withLock { requestCount } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.requestCount += 1 }
        let data = request.url!.path == "/invalid" ? Data("not an image".utf8) : Self.fixture
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/jpeg"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main struct ImagePipelineChecks {
    static func main() async throws {
        // A realistic large upload. Thumbnail decoding should never allocate
        // the full 4000x3000 pixel backing store for a small gallery card.
        let context = CGContext(data: nil, width: 4000, height: 3000, bitsPerComponent: 8, bytesPerRow: 0,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        let source = context.makeImage()!
        let data = NSMutableData()
        let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, source, [kCGImagePropertyOrientation: 6] as CFDictionary)
        assert(CGImageDestinationFinalize(destination))
        FixtureProtocol.fixture = data as Data
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FixtureProtocol.self]
        let pipeline = InspirationImagePipeline(session: URLSession(configuration: config))
        let url = "https://fixtures.invalid/photo"
        let images = try await withThrowingTaskGroup(of: InspirationDecodedImage.self) { group in
            for _ in 0..<12 { group.addTask { try await pipeline.image(for: url, pixelLimit: 768) } }
            var results: [InspirationDecodedImage] = []
            for try await image in group { results.append(image) }
            return results
        }
        assert(FixtureProtocol.count == 1, "Concurrent cards must share one download")
        assert(images.allSatisfy { $0 === images[0] }, "Concurrent cards must share decoded pixels")
        let image = images[0]
        assert(image.image.width == 576 && image.image.height == 768, "EXIF orientation must be applied")
        assert(abs(image.aspectRatio - 0.75) < 0.001)
        assert(pipeline.cachedAspectRatio(for: url) == image.aspectRatio)
        _ = try await pipeline.image(for: url, pixelLimit: 768)
        assert(FixtureProtocol.count == 1, "Re-entering the viewport must reuse memory cache")
        let thumb = try await pipeline.image(for: url, pixelLimit: 256)
        assert(max(thumb.image.width, thumb.image.height) == 256)
        for _ in 0..<2 {
            do {
                _ = try await pipeline.image(for: "https://fixtures.invalid/invalid", pixelLimit: 768)
                assertionFailure("Invalid image should fail")
            } catch { /* failure must clear the in-flight task so retry works */ }
        }
        assert(FixtureProtocol.count == 4)
        let rawBytes = source.bytesPerRow * source.height
        print("PASS: request coalescing, cache reuse, pixel limits, EXIF orientation, failure retry")
        print("4000x3000 upload: full decoded pixels \(rawBytes) bytes; gallery \(image.byteCount) bytes (\(Int((1 - Double(image.byteCount) / Double(rawBytes)) * 100))% less)")
    }
}
