import test from 'node:test';
import assert from 'node:assert/strict';
import { newsBedArgs } from '../scripts/claude-lane/reel-audio.mjs';

test('builds an m4a bed with a sting, a noise bed and a fade-out', () => {
  const r = newsBedArgs({ seconds: 30, out: 'bed.m4a' });
  assert.equal(r.ok, true);
  const all = r.args.join(' ');
  assert.match(all, /sine=frequency=880/);
  assert.match(all, /aevalsrc=/);
  assert.match(all, /afade=t=out:st=28:d=2/);
  assert.equal(r.args.at(-1), 'bed.m4a');
});
test('rejects bad durations and non-m4a outputs', () => {
  assert.equal(newsBedArgs({ seconds: 2, out: 'a.m4a' }).reason, 'duration_out_of_range');
  assert.equal(newsBedArgs({ seconds: 30, out: 'a.mp3' }).reason, 'output_must_be_m4a');
});
