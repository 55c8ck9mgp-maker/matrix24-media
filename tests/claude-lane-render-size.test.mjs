import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Spanish and English headlines on the news card must share one font size and
// weight, otherwise the two lines look mismatched (seen 2026-10-09).
let hasPillow = true;
try { execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }); } catch { hasPillow = false; }
const skip = !hasPillow && process.env.CLAUDE_LANE_REQUIRE_RENDER !== '1' && 'Pillow not installed';

const CODE = `
import sys, json
sys.path.insert(0, 'scripts/claude-lane')
from PIL import Image, ImageDraw
import render_card as r
d = ImageDraw.Draw(Image.new('RGB', (10, 10)))
for es, en in [
  ('Navi Pillay gana el Premio Nobel de la Paz tras una larga carrera en defensa de los derechos humanos', 'Navi Pillay wins Nobel Peace Prize'),
  ('Corto', 'Short'),
  ('Palabra ' * 60, 'Word ' * 60),
]:
    size, (hf, hl), (ef, el) = r.fit_pair(d, es.upper(), True, 6, en, True, 4, 1080 - 128, 84, 28)
    print(json.dumps({'hf': hf.size, 'ef': ef.size, 'size': size, 'hl': len(hl), 'el': len(el)}))
`;

test('Spanish and English headlines share one font size and weight', { skip }, () => {
  const out = execFileSync('python3', ['-c', CODE]).toString().trim().split('\n').map(l => JSON.parse(l));
  for (const row of out) {
    assert.equal(row.hf, row.ef, 'same size');
    assert.equal(row.hf, row.size);
    assert.ok(row.hl <= 6 && row.el <= 4, 'line limits respected');
  }
});
