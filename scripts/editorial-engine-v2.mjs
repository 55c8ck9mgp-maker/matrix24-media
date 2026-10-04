// MATRIX24 Editorial Engine v2
// Single responsibility: discover fresh candidate stories. Admission, promotion and
// publication remain owned by the existing guarded pipeline.
const feeds = [
  { source: 'BBC', source_id: 'bbc', region: 'world', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { source: 'BBC', source_id: 'bbc', region: 'latin-america', url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml' },
  { source: 'BBC', source_id: 'bbc', region: 'europe', url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml' },
  { source: 'BBC', source_id: 'bbc', region: 'asia', url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml' },
  { source: 'NPR', source_id: 'npr', region: 'world', url: 'https://feeds.npr.org/1004/rss.xml' },
  { source: 'DW', source_id: 'dw', region: 'world', url: 'https://rss.dw.com/rdf/rss-en-world' },
  { source: 'France 24', source_id: 'france24', region: 'world', url: 'https://www.france24.com/en/rss' },
  { source: 'Al Jazeera', source_id: 'aljazeera', region: 'world', url: 'https://www.aljazeera.com/xml/rss/all.xml' }
];

const cutoff = Date.now() - 24 * 60 * 60 * 1000;
const globalSignals = ['government','president','prime minister','election','war','conflict','ceasefire','attack','earthquake','flood','storm','hurricane','wildfire','economy','inflation','trade','tariff','sanction','market','health','outbreak','climate','energy','technology','cyber','space','nasa','science','record'];
const globallyRelevant = item => {
  const text=(item.title+' '+item.description).toLowerCase();
  return globalSignals.some(k=>text.includes(k));
};
const clean = (s='') => s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const field = (block,name) => clean((block.match(new RegExp('<'+name+'[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'))||[])[1]||'');
const words = s => new Set(clean(s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>3));
const similarity = (a,b) => {
  const A=words(a), B=words(b); if(!A.size||!B.size) return 0;
  let hit=0; for(const w of A) if(B.has(w)) hit++;
  return hit / Math.min(A.size,B.size);
};

let items=[];
for (const feed of feeds) {
  try {
    const r=await fetch(feed.url,{headers:{'user-agent':'MATRIX24/2.0'}});
    if(!r.ok){ console.log('feed skipped',feed.source,r.status); continue; }
    const xml=await r.text();
    for(const block of xml.match(/<item[\s\S]*?<\/item>/gi)||[]) {
      const title=field(block,'title'), link=field(block,'link'), pub=field(block,'pubDate'), description=field(block,'description');
      const t=Date.parse(pub);
      if(title&&link&&Number.isFinite(t)&&t>=cutoff) items.push({...feed,title,link,published_at:new Date(t).toISOString(),description});
    }
  } catch(e) { console.log('feed skipped',feed.source,e.message); }
}

items=items.filter(globallyRelevant);
items.sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at));
const groups=[];
for(const item of items){
  let g=groups.find(x=>x.items.some(y=>similarity(y.title,item.title)>=0.55));
  if(!g){g={items:[]};groups.push(g)}
  g.items.push(item);
}

const relevanceTerms = /war|ceasefire|election|president|prime minister|government|earthquake|hurricane|typhoon|flood|wildfire|attack|missile|nuclear|economy|inflation|central bank|trade|tariff|sanction|summit|climate|outbreak|space|technology|cyber|security|record|crisis|disaster/i;
const candidates=groups.map(g=>{
  const unique=[...new Map(g.items.map(x=>[x.source_id,x])).values()];
  return {
    headline:g.items[0].title,
    region:g.items[0].region,
    sources:unique.map(x=>({source_name:x.source,independent_source_id:x.source_id,url:x.link,published_at:x.published_at,title:x.title})),
    consensus_ready:unique.length>=2,
    international_relevance: relevanceTerms.test(g.items.map(x=>x.title+' '+x.description).join(' '))
  };
}).filter(x=>x.consensus_ready && x.international_relevance).slice(0,20);

console.log(JSON.stringify({generated_at:new Date().toISOString(),fresh_items:items.length,consensus_candidates:candidates.length,candidates},null,2));
// Fail closed: no candidate enters editorial/verified, queue, Metricool or Instagram here.
// The existing intake guard requires two independent sources and remains authoritative.
if(!candidates.length) console.log('NO_TWO_SOURCE_CANDIDATE: no publication action taken');


// MATRIX24 Lite cutover: this scheduled research process is read-only.
// It must never create editorial intake files, promotion manifests, queue records,
// or call a publisher. A verified candidate is handed to the Lite publication
// boundary only after image generation + Supabase idempotency preflight are available.
