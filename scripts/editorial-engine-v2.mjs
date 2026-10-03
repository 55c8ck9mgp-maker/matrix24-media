const feeds=[
  ["world","https://feeds.bbci.co.uk/news/world/rss.xml"],
  ["latin-america","https://feeds.bbci.co.uk/news/world/latin_america/rss.xml"],
  ["europe","https://feeds.bbci.co.uk/news/world/europe/rss.xml"],
  ["asia","https://feeds.bbci.co.uk/news/world/asia/rss.xml"]
];
const cutoff=Date.now()-86400000;
const clean=s=>s.replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const field=(b,n)=>clean((b.match(new RegExp("<"+n+"[^>]*>([\\s\\S]*?)<\\/"+n+">","i"))||[])[1]||"");
let candidates=[];
for(const [region,url] of feeds){
  try{
    const r=await fetch(url,{headers:{"user-agent":"MATRIX24/2.0"}});
    if(!r.ok) continue;
    const xml=await r.text();
    for(const item of xml.match(/<item[\s\S]*?<\/item>/gi)||[]){
      const title=field(item,"title"),link=field(item,"link"),pubDate=field(item,"pubDate");
      const t=Date.parse(pubDate);
      if(title&&link&&Number.isFinite(t)&&t>=cutoff)candidates.push({region,title,link,published_at:new Date(t).toISOString()});
    }
  }catch(e){console.log("feed skipped",region,e.message)}
}
candidates.sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at));
console.log(JSON.stringify({generated_at:new Date().toISOString(),count:candidates.length,candidates:candidates.slice(0,30)},null,2));
if(!candidates.length) process.exitCode=2;
