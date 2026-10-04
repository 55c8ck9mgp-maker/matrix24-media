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

const candidates=groups.map(g=>{
  const unique=[...new Map(g.items.map(x=>[x.source_id,x])).values()];
  return {
    headline:g.items[0].title,
    region:g.items[0].region,
    sources:unique.map(x=>({source_name:x.source,independent_source_id:x.source_id,url:x.link,published_at:x.published_at,title:x.title})),
    consensus_ready:unique.length>=2
  };
}).filter(x=>x.consensus_ready).slice(0,20);

console.log(JSON.stringify({generated_at:new Date().toISOString(),fresh_items:items.length,consensus_candidates:candidates.length,candidates},null,2));
// Fail closed: no candidate enters editorial/verified, queue, Metricool or Instagram here.
// The existing intake guard requires two independent sources and remains authoritative.
if(!candidates.length) console.log('NO_TWO_SOURCE_CANDIDATE: no publication action taken');


async function buildDraft(candidate){
  const token=process.env.GITHUB_TOKEN;
  if(!token) return null;
  const sourceText=[];
  for(const s of candidate.sources.slice(0,3)){
    try{
      const r=await fetch(s.url,{headers:{'user-agent':'MATRIX24/2.0'}});
      const html=await r.text();
      sourceText.push({source_name:s.source_name,independent_source_id:s.independent_source_id,url:s.url,text:clean(html).slice(0,7000)});
    }catch{}
  }
  if(sourceText.length<2) return null;
  const prompt=`Create ONE conservative MATRIX24 editorial draft from the supplied independent reports. Retain only material facts explicitly supported by at least two independent sources. If there is no such material factual consensus, return {"reject":true}. Output JSON only. Required keys: headline,category,editorial_category,caption,image_generation_prompt,verification_note,claim,normalized_value,supports. caption must contain English AND Spanish context, clearly separated with 🇺🇸 and 🇪🇸. supports must be an array with one concise support string per supplied source. Do not invent facts. Sources: ${JSON.stringify(sourceText)}`;
  const r=await fetch('https://models.github.ai/inference/chat/completions',{
    method:'POST',
    headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json','Accept':'application/vnd.github+json'},
    body:JSON.stringify({model:'openai/gpt-4.1-mini',temperature:0,max_tokens:1400,messages:[{role:'user',content:prompt}]})
  });
  if(!r.ok) throw new Error(`GitHub Models ${r.status}`);
  const data=await r.json();
  const raw=(data.choices?.[0]?.message?.content||'').replace(/^\`\`\`json\s*|\`\`\`$/g,'').trim();
  const out=JSON.parse(raw);
  if(out.reject) return null;
  const eventDate=(candidate.sources.map(s=>s.published_at).sort()[0]||new Date().toISOString()).slice(0,10);
  const slug=out.headline.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g,'').trim().replace(/\s+/g,'-').slice(0,72);
  const content_id=`matrix24-${eventDate.replaceAll('-','')}-${slug}`;
  const urls=sourceText.map(s=>s.url);
  return {
    content_id, researched_at:new Date().toISOString(), event_date:eventDate,
    headline:out.headline, category:out.category||'World', editorial_category:out.editorial_category||out.category||'World',
    caption:out.caption, hashtags:['#MATRIX24','#GlobalNews'],
    image_generation_prompt:out.image_generation_prompt,
    verification_note:out.verification_note,
    verification_status:'verified_claim_consensus',
    candidate_status:'verified_draft_requires_editorial_promotion',
    promotion_eligible:false,
    verified_source_urls:urls,
    source_records:sourceText.map((s,i)=>({source_name:s.source_name,independent_source_id:s.independent_source_id,source_role:'independent_report',url:s.url,supports:[out.supports?.[i]||out.claim]})),
    claim_checks:[{claim:out.claim,material:true,normalized_value:out.normalized_value,observations:urls.map(url=>({url,normalized_value:out.normalized_value}))}]
  };
}

if(process.env.MATRIX24_CREATE_DRAFT==='1' && candidates.length){
  const fs=await import('node:fs');
  const cp=await import('node:child_process');
  for(const candidate of candidates){
    const draft=await buildDraft(candidate);
    if(!draft) continue;
    const existing=cp.execSync("git ls-files 'editorial/verified/*.json' 'queue/*.json'",{encoding:'utf8'}).split(/\n/).filter(Boolean);
    if(existing.some(p=>p.includes(draft.content_id))){console.log('DUPLICATE_SKIPPED',draft.content_id);continue}
    fs.mkdirSync('editorial/verified',{recursive:true});
    const outPath=`editorial/verified/${draft.content_id}.json`;
    fs.writeFileSync(outPath,JSON.stringify(draft,null,2)+'\n');
    console.log('DRAFT_CREATED',outPath);
    break;
  }
}
