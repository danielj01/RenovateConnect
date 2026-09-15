# Inspiration performance checks

Run on macOS with Xcode installed:

```sh
python3 ios/PerformanceChecks/run.py
```

The runner compiles the production image pipeline, feed store, saved store, and feed models into temporary executables. The networking fixtures never contact the API or modify its database. UserDefaults checks use a temporary suite.

Coverage:
- Concurrent image requests share a download and decoded image.
- Cached images avoid another request, respect pixel limits, and apply EXIF orientation.
- Invalid image failures can be retried.
- Pagination preserves order, deduplicates IDs, and ignores stale category responses.
- Feed columns and saved collections remain correct after changes and restarts.

The image check compares decoded pixel memory for a synthetic 4000×3000 JPEG with a 768-pixel gallery thumbnail. This is an allocation comparison, not an FPS measurement. Profile scrolling on a physical device with Instruments to measure frame timing.
