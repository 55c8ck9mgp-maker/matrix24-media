export function normalizeText(v=""){return String(v).toLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu,"").replace(/[^a-z0-9]+/g," ").trim();}
export function reconcileMatch(queue,posts){
 const qid=queue.content_id;
 const receipt=queue.provider_receipt||queue.instagram_media_id||null;
 const qcap=normalizeText(queue.caption||queue.title||"");
 const candidates=posts.map(p=>{
  const pid=p.content_id||p.metadata?.content_id||null;
  const prec=p.provider_receipt||p.id||p.instagram_media_id||null;
  const pcap=normalizeText(p.caption||"");
  let score=0,reasons=[];
  if(qid&&pid===qid){score+=100;reasons.push("content_id");}
  if(receipt&&prec===receipt){score+=100;reasons.push("provider_receipt");}
  if(qcap&&pcap&&(qcap===pcap||qcap.startsWith(pcap)||pcap.startsWith(qcap))){score+=30;reasons.push("caption_prefix");}
  if(queue.media_sha256&&p.media_sha256===queue.media_sha256){score+=60;reasons.push("media_sha256");}
  return {post:p,score,reasons};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 if(!candidates.length)return {status:"no_match"};
 if(candidates.length>1&&candidates[0].score===candidates[1].score)return {status:"ambiguous",candidates:candidates.slice(0,2)};
 const best=candidates[0];
 if(best.score<30)return {status:"no_match"};
 return {status:"matched",post:best.post,reasons:best.reasons,score:best.score};
}
