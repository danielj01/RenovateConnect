#!/usr/bin/env python3
"""Run focused checks against production sources on macOS, without an API/database."""
import subprocess
import tempfile
from pathlib import Path

checks = Path(__file__).resolve().parent
app = checks.parent / 'RenovateConnect' / 'RenovateConnect'
with tempfile.TemporaryDirectory(prefix='inspiration-checks-') as tmp:
    tmp = Path(tmp)
    models = (app / 'Models/Models.swift').read_text()
    snippets = []
    for name in ['FeedSlide', 'FeedItemKind', 'FeedItem', 'FeedBusiness', 'FeedResponse']:
        marker = ('enum ' if name == 'FeedItemKind' else 'struct ') + name + ':'
        start = models.index(marker)
        snippets.append(models[start:models.index('\n}', start) + 2])
    saved = (app / 'Views/Home/SavedInspirationView.swift').read_text()
    saved = saved[:saved.index('struct SavedInspirationView: View')]
    fixture = tmp / 'ProductionModelsAndSavedStore.swift'
    fixture.write_text('import Foundation\n' + '\n\n'.join(snippets) + '\n' + saved)
    for name, sources in [
        ('images', [app / 'Services/InspirationImagePipeline.swift', checks / 'ImagePipelineChecks.swift']),
        ('feed', [fixture, app / 'Services/InspirationFeedStore.swift', checks / 'FeedRegressionChecks.swift']),
    ]:
        executable = tmp / name
        subprocess.run(['swiftc', '-parse-as-library', *map(str, sources), '-o', str(executable)], check=True)
        subprocess.run([str(executable)], check=True)
