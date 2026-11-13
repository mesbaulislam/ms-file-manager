# Regenerates /tmp/msfm-zips fixtures for tests/archive-test.js (fixtures are
# ephemeral: /tmp is wiped on VM restart). Run: python3 tests/make-fixtures.py
import zipfile, os
B = '/tmp/msfm-zips/'
os.makedirs(B, exist_ok=True)
with zipfile.ZipFile(B+'t1.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('hello.txt', 'Hello KaiOS! ' * 500)
    z.writestr('docs/readme.txt', 'readme content')
    z.writestr('empty.txt', '')
    z.writestr('photos/', '')
    z.writestr('bin/data.bin', bytes((i * 7) % 256 for i in range(200000)))
with zipfile.ZipFile(B+'t2.zip', 'w', zipfile.ZIP_STORED) as z:
    z.writestr('stored.txt', 'stored content ' * 50)
with zipfile.ZipFile(B+'t3.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('../../evil.txt', 'evil')
    z.writestr('ok.txt', 'ok')
with zipfile.ZipFile(B+'t4.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('café-日本語.txt', 'unicode name body')
with open(B+'t5.bin', 'wb') as f:
    f.write(os.urandom(512))
print('fixtures written:', sorted(os.listdir(B)))
