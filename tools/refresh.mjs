import fs from 'node:fs';
import path from 'node:path';

const ROOT=path.resolve(new URL('..',import.meta.url).pathname);
const SOURCE=path.join(ROOT,'catalogs-source.json');
const OUT=path.join(ROOT,'addon');
const HOSTS=['cinemana.shabakaty.com','cinemana.shabakaty.cc'];
const UA='Cinemana-Stremio-Static-Refresh/2.0';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const arr=v=>Array.isArray(v)?v:Array.isArray(v?.data)?v.data:Array.isArray(v?.content)?v.content:Array.isArray(v?.videos)?v.videos:[];
const clean=v=>String(v||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f\u064B-\u065F\u0670]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9\u0600-\u06ff]+/g,' ').trim();
const yearOf=v=>Number(String(v?.year||v?.releaseInfo||v?.publishDate||v?.release_date||v?.mDate||'').match(/(?:19|20)\d{2}/)?.[0]||0);
const titleOf=v=>String(v?.en_title||v?.title||v?.other_title||v?.ar_title||v?.name||'').trim();
const imdbOf=v=>String(v?.imdbUrlRef||v?.imdbId||v?.imdb_id||v?.imdb||v?.id||'').match(/tt\d{5,12}/i)?.[0]?.toLowerCase()||'';
const b64=s=>Buffer.from(String(s||''),'utf8').toString('base64');
const goodUrl=v=>{let s=String(v||'').trim();if(s.startsWith('//'))s='https:'+s;return /^https?:\/\//i.test(s)?s:''};
const quality=v=>Number(String(v?.resolution??v??'').match(/(2160|1440|1080|720|576|480|360|240)/)?.[1]||0);

async function fetchJson(url,ms=10000){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),ms);
  try{
    const r=await fetch(url,{signal:ac.signal,headers:{'User-Agent':UA,'Accept':'application/json,*/*'}});
    if(!r.ok)throw new Error('http_'+r.status);
    return await r.json();
  }finally{clearTimeout(timer)}
}
async function cine(rel){
  let last;
  for(const host of HOSTS){
    try{return await fetchJson('https://'+host+'/api/android/'+String(rel).replace(/^\/+/,''),10000)}
    catch(e){last=e}
  }
  throw last||new Error('cinemana_unavailable');
}
async function cineSearch(kind,q){
  const query=encodeURIComponent(b64(q));
  return arr(await cine('video/V/2/videoKind/'+kind+'/categoryNb/0/langNb/0/sortParam/desc/itemsPerPage/30/video_title_search/'+query+'/pageNumber/0/enableTranslation/0/level/1'));
}
async function cinemetaSearch(type,title,year){
  try{
    const j=await fetchJson('https://v3-cinemeta.strem.io/catalog/'+type+'/top/search='+encodeURIComponent(title)+'.json',8000);
    const rows=arr(j?.metas||j),wanted=clean(title);
    const hit=rows.find(x=>clean(x?.name)===wanted&&(!year||yearOf(x)===Number(year)))
      ||rows.find(x=>clean(x?.name)===wanted)
      ||rows.find(x=>yearOf(x)===Number(year))
      ||rows[0];
    return imdbOf(hit);
  }catch{return ''}
}
function candidateKey(x,type){
  const iid=imdbOf(x);
  return iid?type+':i:'+iid:type+':t:'+clean(x?.title||x?.name)+'|'+(Number(x?.year)||0);
}
async function resolveRoot(candidate,type){
  const kind=type==='series'?2:1;
  const queries=[candidate.title,...(candidate.aliases||[])].map(String).map(x=>x.trim()).filter(Boolean).slice(0,3);
  const pool=[];
  for(const q of queries){
    try{pool.push(...await cineSearch(kind,q))}catch{}
  }
  const dedup=new Map();
  for(const x of pool)if(x?.nb&&!dedup.has(String(x.nb)))dedup.set(String(x.nb),x);
  let best=null,bestScore=-9999;
  const wantedTitles=queries.map(clean);
  const wantedImdb=imdbOf(candidate);
  for(const row of dedup.values()){
    const rowImdb=imdbOf(row),rt=clean(titleOf(row)),ry=yearOf(row);
    let score=0;
    if(wantedImdb&&rowImdb)score=rowImdb===wantedImdb?1000:-1000;
    const exact=wantedTitles.includes(rt);
    if(score<1000&&exact&&candidate.year&&ry===Number(candidate.year))score=Math.max(score,250);
    else if(score<1000&&exact&&candidate.year&&Math.abs(ry-Number(candidate.year))<=1)score=Math.max(score,180);
    else if(score<1000&&exact)score=Math.max(score,120);
    if(type==='series'&&String(row?.rootSeries||'0')==='0')score+=10;
    if(score>bestScore){bestScore=score;best=row}
  }
  if(!best||bestScore<=0)return null;
  let iid=wantedImdb||imdbOf(best);
  if(!iid)iid=await cinemetaSearch(type,candidate.title,candidate.year);
  if(!iid)return null;
  const nb=type==='series'&&String(best?.rootSeries||'0')!=='0'?String(best.rootSeries):String(best.nb);
  return {iid,nb,row:best,score:bestScore};
}
async function streamRows(nb){
  try{
    return arr(await cine('transcoddedFiles/id/'+encodeURIComponent(nb)))
      .map(x=>({resolution:String(x?.resolution||''),videoUrl:goodUrl(x?.videoUrl)}))
      .filter(x=>x.videoUrl)
      .sort((a,b)=>quality(b)-quality(a));
  }catch{return[]}
}
async function mapLimit(list,limit,fn){
  const out=new Array(list.length);let next=0;
  async function worker(){for(;;){const i=next++;if(i>=list.length)return;try{out[i]=await fn(list[i],i)}catch(e){out[i]=null}}}
  await Promise.all(Array.from({length:Math.min(limit,list.length)},worker));
  return out;
}
function streamPayload(rows){
  return {streams:(rows||[]).map((x,i)=>{
    const q=quality(x);
    return {name:'Cinemana'+(q?' • '+q+'p':''),title:String(x?.resolution||('Source '+(i+1))),url:goodUrl(x.videoUrl),behaviorHints:{bingeGroup:'cinemana-direct'}};
  }).filter(x=>x.url)};
}
function writeJson(file,obj){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(obj));
}

const catalogs=JSON.parse(fs.readFileSync(SOURCE,'utf8'));
const occurrences=[];
for(const c of catalogs)for(const m of c.members||[])occurrences.push({catalog:c,member:m,type:c.type});
const unique=[],seen=new Set();
for(const o of occurrences){
  const k=candidateKey(o.member,o.type);
  if(!seen.has(k)){seen.add(k);unique.push({type:o.type,member:o.member,key:k})}
}
console.log('Unique catalog titles:',unique.length);

const rootResults=await mapLimit(unique,8,async x=>{
  const r=await resolveRoot(x.member,x.type);
  return r?{...x,...r}:null;
});
const resolved=rootResults.filter(Boolean);
console.log('Resolved roots:',resolved.length+'/'+unique.length);

const byKey=new Map(resolved.map(x=>[x.key,x]));
for(const o of occurrences){
  const r=byKey.get(candidateKey(o.member,o.type));
  if(r?.iid)o.member.imdb=r.iid;
}
fs.writeFileSync(SOURCE,JSON.stringify(catalogs,null,2)+'\n');

const movieRoots=resolved.filter(x=>x.type==='movie');
const movieValues=await mapLimit(movieRoots,10,async x=>({id:x.iid,rows:await streamRows(x.nb)}));
const movieStreams=new Map(movieValues.filter(x=>x?.rows?.length).map(x=>[x.id,x.rows]));
console.log('Movies with streams:',movieStreams.size+'/'+movieRoots.length);

const seriesRoots=resolved.filter(x=>x.type==='series');
const seriesEpisodeSets=await mapLimit(seriesRoots,8,async x=>{
  try{
    const eps=arr(await cine('videoSeason/id/'+encodeURIComponent(x.nb)));
    const uniq=new Map();
    for(const e of eps){
      const season=Number(e?.season)||1,episode=Number(e?.episodeNummer||e?.episodeNumber||e?.episode)||1;
      const key=x.iid+':'+season+':'+episode;
      if(!e?.nb||uniq.has(key))continue;
      uniq.set(key,{key,nb:String(e.nb),season,episode});
    }
    return {id:x.iid,episodes:[...uniq.values()]};
  }catch{return {id:x.iid,episodes:[]}}
});
const episodeTasks=seriesEpisodeSets.flatMap(x=>x?.episodes||[]);
console.log('Series roots:',seriesRoots.length,'episode stream tasks:',episodeTasks.length);
const episodeValues=await mapLimit(episodeTasks,12,async e=>({key:e.key,rows:await streamRows(e.nb)}));
const seriesStreams=new Map(episodeValues.filter(x=>x?.rows?.length).map(x=>[x.key,x.rows]));
console.log('Series episodes with streams:',seriesStreams.size+'/'+episodeTasks.length);

fs.rmSync(OUT,{recursive:true,force:true});
const manifest={
  id:'com.mohammad.cinemana.stremio.static',
  version:'2.0.0',
  name:'Cinemana Collections',
  description:'Independent Cinemana catalogs and direct movie/series streams refreshed from Iraq.',
  types:['movie','series'],
  resources:['catalog',{name:'stream',types:['movie','series'],idPrefixes:['tt']}],
  catalogs:catalogs.map(c=>({type:c.type,id:c.id,name:c.title})),
  behaviorHints:{configurable:false,p2p:false,adult:false}
};
writeJson(path.join(OUT,'manifest.json'),manifest);
fs.writeFileSync(path.join(OUT,'index.html'),'Cinemana Stremio Addon');

for(const c of catalogs){
  const metas=(c.members||[]).flatMap(m=>{
    const iid=imdbOf(m);if(!iid)return[];
    return [{id:iid,type:c.type,name:String(m.title||iid),poster:'https://images.metahub.space/poster/medium/'+iid+'/img',background:'https://images.metahub.space/background/medium/'+iid+'/img',releaseInfo:m.year?String(m.year):undefined}];
  });
  writeJson(path.join(OUT,'catalog',c.type,c.id+'.json'),{metas});
}
for(const [id,rows] of movieStreams)writeJson(path.join(OUT,'stream','movie',id+'.json'),streamPayload(rows));
for(const [id,rows] of seriesStreams)writeJson(path.join(OUT,'stream','series',id+'.json'),streamPayload(rows));

const stats={
  generatedAt:new Date().toISOString(),
  catalogs:catalogs.length,
  resolvedRoots:resolved.length,
  totalUnique:unique.length,
  movieStreams:movieStreams.size,
  seriesRoots:seriesRoots.length,
  seriesEpisodeStreams:seriesStreams.size,
  seriesEpisodeTasks:episodeTasks.length
};
writeJson(path.join(OUT,'stats.json'),stats);
console.log('STATS='+JSON.stringify(stats));
