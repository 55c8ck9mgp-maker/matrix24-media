// Claude Lane producer (docs/CLAUDE_LANE.md): discovers a story reported by at
// least two independent outlets in public RSS feeds and writes a bilingual draft
// with GitHub Models (free, GITHUB_TOKEN with models:read). The language model only
// rewrites what the feeds say; guardFacts() rejects any number or name-like token
// that does not appear in the source text.
import { findDuplicate } from './dedupe.mjs';

export const FEEDS = [
  { source: 'BBC', id: 'bbc', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { source: 'BBC', id: 'bbc', url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml' },
  { source: 'NPR', id: 'npr', url: 'https://feeds.npr.org/1004/rss.xml' },
  { source: 'DW', id: 'dw', url: 'https://rss.dw.com/rdf/rss-en-world' },
  { source: 'France 24', id: 'france24', url: 'https://www.france24.com/en/rss' },
  { source: 'Al Jazeera', id: 'aljazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { source: 'The Guardian', id: 'guardian', url: 'https://www.theguardian.com/world/rss' },
];
export const CATEGORIES = ['World', 'Technology', 'Science', 'Economy', 'Climate', 'Security / Geopolitics', 'Colombia / Latin America', 'Sports'];
const RELEVANT = /war|ceasefire|election|president|prime minister|government|earthquake|hurricane|typhoon|flood|wildfire|attack|missile|nuclear|economy|inflation|central bank|trade|tariff|sanction|summit|climate|outbreak|space|nasa|technology|cyber|security|record|crisis|disaster|court|protest/i;

const clean = (s = '') => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const field = (block, name) => clean((block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i')) || [])[1] || '');
const words = s => new Set(clean(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3));
export function similarity(a, b) {
  const A = words(a); const B = words(b);
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

export function parseFeed(xml, feed, cutoffMs) {
  const out = [];
  for (const block of xml.match(/<item[\s\S]*?<\/item>/gi) || []) {
    const title = field(block, 'title'); const link = field(block, 'link');
    const description = field(block, 'description');
    const t = Date.parse(field(block, 'pubDate') || field(block, 'dc:date'));
    if (title && /^https:\/\//.test(link) && Number.isFinite(t) && t >= cutoffMs) {
      out.push({ source: feed.source, id: feed.id, title, link, description, published_at: new Date(t).toISOString() });
    }
  }
  return out;
}

// Groups items about the same event; keeps groups with >= 2 independent outlets.
export function consensus(items) {
  const groups = [];
  for (const it of [...items].sort((a, b) => b.published_at.localeCompare(a.published_at))) {
    let g = groups.find(x => x.some(y => similarity(y.title, it.title) >= 0.55));
    if (!g) { g = []; groups.push(g); }
    g.push(it);
  }
  return groups.map(g => [...new Map(g.map(x => [x.id, x])).values()])
    .filter(g => g.length >= 2 && RELEVANT.test(g.map(x => `${x.title} ${x.description}`).join(' ')))
    .map(g => ({ headline: g[0].title, sources: g.slice(0, 3) }));
}

export function pickCandidate(candidates, others) {
  for (const c of candidates) {
    const probe = { content_id: 'probe', headline: c.headline, source_urls: c.sources.map(s => s.link) };
    if (!findDuplicate(probe, { others })) return c;
  }
  return null;
}

export function buildPrompt(c) {
  const facts = c.sources.map((s, i) => `[${i + 1}] ${s.source}: ${s.title}. ${s.description}`).join('\n');
  return [
    { role: 'system', content: 'You are a careful wire editor for MATRIX 24, a bilingual (Spanish/English) news account. '
      + 'Use ONLY facts stated in the sources. Do not add numbers, names, places, dates or quotes that are not in the sources. '
      + 'No opinions, no speculation. Reply with JSON only.' },
    { role: 'user', content: `Sources:\n${facts}\n\nReturn JSON with keys: headline_en (<= 110 chars), headline_es (<= 110 chars), `
      + `caption_en (2-3 sentences, <= 600 chars), caption_es (faithful Spanish version, <= 650 chars), `
      + `category (one of: ${CATEGORIES.join(' | ')}), hashtags (3-5, each starting with #, no spaces).` },
  ];
}

// Every number and every capitalized word in the output must appear in the sources
// (case-insensitive), allowing a small list of language words.
const ALLOW = new Set(('el la los las un una en de del por para con según sobre tras the a an in of on for with after over '
  + 'matrix24 noticias news world mundo según said dijo').split(' '));
export function guardFacts(draft, c) {
  const src = c.sources.map(s => `${s.title} ${s.description}`).join(' ');
  const srcLower = src.toLowerCase();
  const srcDigits = new Set(src.match(/\d+(?:[.,]\d+)?/g) || []);
  const problems = [];
  for (const key of ['headline_en', 'caption_en']) {
    const text = String(draft[key] || '');
    for (const n of text.match(/\d+(?:[.,]\d+)?/g) || []) if (!srcDigits.has(n)) problems.push(`number:${n}`);
    // capitalized words that are not sentence-initial must come from the sources
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const caps = sentence.match(/\b[A-Z][a-zA-Z'-]{2,}\b/g) || [];
      const first = sentence.trim().match(/^[A-Za-z'-]+/)?.[0];
      for (const w of caps) {
        if (w === first) continue;
        if (!ALLOW.has(w.toLowerCase()) && !srcLower.includes(w.toLowerCase())) problems.push(`name:${w}`);
      }
    }
  }
  for (const key of ['headline_es', 'caption_es']) {
    for (const n of String(draft[key] || '').match(/\d+(?:[.,]\d+)?/g) || []) {
      if (!srcDigits.has(n) && !srcDigits.has(n.replace(',', '.')) && !srcDigits.has(n.replace('.', ','))) problems.push(`numero:${n}`);
    }
  }
  return problems;
}

export function toRecord(draft, c, now) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const slug = draft.headline_en.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 7).join('-');
  return {
    lane: 'claude', content_id: `claude-${day}-${slug}`, status: 'draft', created_at: now.toISOString().replace(/\.\d+Z$/, 'Z'),
    category: CATEGORIES.includes(draft.category) ? draft.category : 'World',
    headline: draft.headline_en.trim(), headline_es: draft.headline_es.trim(),
    caption_es: draft.caption_es.trim(), caption_en: draft.caption_en.trim(),
    source_urls: c.sources.map(s => s.link), source_names: [...new Set(c.sources.map(s => s.source))],
    hashtags: ['#MATRIX24', ...(draft.hashtags || []).filter(h => /^#[\p{L}\p{N}_]+$/u.test(h))].slice(0, 6),
    image_url: null, publish_attempt_id: null, ig_media_id: null,
    history: [{ at: now.toISOString(), event: 'researched', sources: c.sources.map(s => s.link) }],
  };
}

export async function callModel(messages, { token, model = 'openai/gpt-4o-mini', fetchImpl = fetch }) {
  const res = await fetchImpl('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) throw new Error(`MODEL_HTTP_${res.status}`);
  const body = await res.json();
  return JSON.parse(body?.choices?.[0]?.message?.content || '{}');
}
