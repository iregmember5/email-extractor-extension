from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root = Path('dist')
version = json.loads((root / 'manifest.json').read_text())['version']
filename = f'powerly-email-extractor-{version}.zip'
with ZipFile(filename, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(root))
print(f'Created {filename}')
