import type { AnimeDiscoveryQuery, AnimeDiscoveryResult, AnimeWork } from '@acg-codenames/shared';
import { animeCatalog, catalogSeries, persistAnimeWorks } from './anime-catalog.js';
import { CommunityError } from './anime-pool-store.js';

const API='https://api.bgm.tv/v0';
const UA='Zao-c/cipai-codenames/2.1 (https://github.com/Zao-c/codenames-acg)';
const record=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const text=(v:unknown,max=200)=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,'').trim().slice(0,max):'';
const number=(v:unknown,max:number):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:null;
const date=(v:unknown)=>{const s=text(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s?s:'';};
function cover(v:unknown):string{try{const u=new URL(text(v,1000));return u.protocol==='https:'&&['lain.bgm.tv','lain.bangumi.tv'].includes(u.hostname)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function subjectId(value:unknown):number {
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=2147483647)return value;
  if(typeof value!=='string'||value.length>300)throw new CommunityError('请输入合法 Bangumi 条目 ID 或官方条目链接');
  let raw=value.trim();
  if(!/^\d+$/.test(raw)){try{const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||!['bgm.tv','bangumi.tv','chii.in'].includes(u.hostname)||u.username||u.password||u.port||u.search||u.hash)throw 0;raw=/^\/subject\/(\d+)\/?$/.exec(u.pathname)?.[1]??'';}catch{throw new CommunityError('仅支持 bgm.tv、bangumi.tv、chii.in 的标准 subject 条目链接');}}
  const id=Number(raw);if(!Number.isSafeInteger(id)||id<1||id>2147483647)throw new CommunityError('条目 ID 无效');return id;
}
export function normalizeSubject(value:unknown):AnimeWork {
  const s=record(value),id=subjectId(s.id);
  if(s.type!==2||s.nsfw===true)throw new CommunityError('仅支持公开、非成人的动画条目');
  const fullTitle=text(s.name_cn)||text(s.name);if(!fullTitle)throw new CommunityError('Bangumi 条目缺少作品名称');
  const aliases=[text(s.name),text(s.name_cn)];
  for(const field of Array.isArray(s.infobox)?s.infobox.slice(0,100):[])if(field?.key==='别名'){if(typeof field.value==='string')aliases.push(text(field.value));else if(Array.isArray(field.value))for(const alias of field.value.slice(0,30))aliases.push(text(alias?.v));}
  const platform=text(s.platform,40);const type:AnimeWork['type']=({'TV':'TV','OVA':'OVA','ONA':'ONA','WEB':'ONA','剧场版':'电影','Movie':'电影','电影':'电影'} as Record<string,AnimeWork['type']>)[platform]??'未知';
  const rating=record(s.rating),collection=record(s.collection),ratingCount=number(rating.total,1e9);
  const tags=[...(Array.isArray(s.tags)?s.tags.map(t=>typeof t==='string'?t:t?.name):[]),...(Array.isArray(s.meta_tags)?s.meta_tags:[])].map(t=>text(t,40)).filter(Boolean);
  return catalogSeries({id,title:fullTitle,fullTitle,aliases:[...new Set(aliases.filter(Boolean))],cover:cover(record(s.images).common??record(s.images).large),type,seriesId:`bgm:${id}`,airDate:date(s.date),tags:[...new Set(tags)].slice(0,60),rating:ratingCount?number(rating.score,10):null,ratingCount,popularity:number(collection.collect,1e9),source:'bangumi',updatedAt:Date.now(),seriesSource:'subject-id'});
}
export function discoveryQuery(value:unknown):AnimeDiscoveryQuery {
  const s=record(value),q:AnimeDiscoveryQuery={q:text(s.q,101),tags:[],tagMode:s.tagMode??'all',sort:s.sort??'match',source:s.source??'bangumi',offset:s.offset??0};
  if(q.q!.length>100||!['all','any'].includes(q.tagMode!)||!['match','score','heat','recent'].includes(q.sort!)||!['bangumi','cache'].includes(q.source!)||!Number.isInteger(q.offset)||q.offset!<0||q.offset!>2000)throw new CommunityError('搜索条件无效，关键词最多 100 字、最多浏览 2000 条原始结果');
  for(const [key,min,max] of [['yearFrom',1900,2100],['yearTo',1900,2100],['quarter',1,4],['minRating',0,10],['minVotes',0,1e9]] as const){if(s[key]!==undefined&&s[key]!==null&&s[key]!==''){if(typeof s[key]!=='number'||!Number.isFinite(s[key])||s[key]<min||s[key]>max||(key!=='minRating'&&!Number.isInteger(s[key])))throw new CommunityError('年份、季度、评分或人数条件无效');(q as any)[key]=s[key];}}
  if(q.yearFrom&&q.yearTo&&q.yearFrom>q.yearTo)throw new CommunityError('开始年份不能晚于结束年份');
  if(s.type!==undefined&&s.type!==''){if(!['TV','电影','OVA','ONA','未知'].includes(s.type))throw new CommunityError('作品形式无效');q.type=s.type;}
  if(s.tags!==undefined){if(!Array.isArray(s.tags)||s.tags.length>4||!s.tags.every((t:unknown)=>typeof t==='string'&&t.trim().length>0&&t.length<=30&&!t.startsWith('-')))throw new CommunityError('最多组合 4 个标签，每个不超过 30 字');q.tags=[...new Set(s.tags.map((t:string)=>t.trim()))] as string[];}
  return q;
}
export function filterAnime(works:AnimeWork[],q:AnimeDiscoveryQuery):AnimeWork[]{
  const keyword=q.q?.toLocaleLowerCase();
  return works.filter(w=>{
    const year=Number(w.airDate.slice(0,4)),month=Number(w.airDate.slice(5,7));
    if(keyword&&!`${w.id} ${w.title} ${w.fullTitle} ${w.aliases.join(' ')}`.toLocaleLowerCase().includes(keyword))return false;
    if(q.yearFrom&&(!year||year<q.yearFrom)||q.yearTo&&(!year||year>q.yearTo)||q.quarter&&(!month||Math.ceil(month/3)!==q.quarter)||q.type&&w.type!==q.type)return false;
    if(q.minRating&&((w.rating??-1)<q.minRating)||q.minVotes&&((w.ratingCount??-1)<q.minVotes))return false;
    if(q.tags?.length){const match=(t:string)=>w.tags?.some(tag=>tag.toLocaleLowerCase()===t.toLocaleLowerCase())??false;if(q.tagMode==='any'?!q.tags.some(match):!q.tags.every(match))return false;}
    return true;
  });
}
function sortWorks(works:AnimeWork[],q:AnimeDiscoveryQuery){return works.sort((a,b)=>q.sort==='score'?(b.rating??-1)-(a.rating??-1)||a.id-b.id:q.sort==='heat'?(b.popularity??-1)-(a.popularity??-1)||a.id-b.id:q.sort==='recent'?b.airDate.localeCompare(a.airDate)||a.id-b.id:0);}

export class BangumiAdapter {
  private cache=new Map<string,{until:number;value:unknown}>();
  private inflight=new Map<string,Promise<unknown>>();
  private tail:Promise<unknown>=Promise.resolve();private nextAt=0;private blockedUntil=0;
  constructor(private readonly fetcher:typeof fetch=fetch,private readonly spacing=300,private readonly timeout=8000){}
  private request(path:string,body?:unknown):Promise<any>{
    const key=path+JSON.stringify(body??null),hit=this.cache.get(key);if(hit&&hit.until>Date.now())return Promise.resolve(hit.value);
    const running=this.inflight.get(key);if(running)return running;
    if(Date.now()<this.blockedUntil)return Promise.reject(new CommunityError('Bangumi 暂时限流或不可用，请稍后重试；已有缓存仍可使用',503));
    if(this.inflight.size>=12)return Promise.reject(new CommunityError('搜索请求较多，请稍后重试',429));
    const operation=this.tail.then(async()=>{
      const delay=Math.max(0,this.nextAt-Date.now());if(delay)await new Promise(r=>setTimeout(r,delay));this.nextAt=Date.now()+this.spacing;
      if(Date.now()<this.blockedUntil)throw new CommunityError('Bangumi 正在退避，请稍后重试',503);
      try{
        const response=await this.fetcher(`${API}${path}`,{method:body?'POST':'GET',headers:{'User-Agent':UA,'Accept':'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(this.timeout)});
        if(response.status===404)throw new CommunityError('Bangumi 条目不存在或不是公开条目',404);
        if(!response.ok){if(response.status===429||response.status>=500)this.blockedUntil=Date.now()+Math.min(60000,Math.max(5000,Number(response.headers.get('retry-after'))*1000||10000));throw new CommunityError(response.status===429?'Bangumi 请求过于频繁，请稍后重试':'Bangumi 暂时不可用，请使用服务器缓存',503);}
        if(Number(response.headers.get('content-length'))>2_000_000)throw new CommunityError('Bangumi 响应过大，已停止读取',502);
        const reader=response.body?.getReader();if(!reader)throw new Error('empty body');const chunks:Uint8Array[]=[];let size=0;
        while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2_000_000){await reader.cancel();throw new CommunityError('Bangumi 响应过大，已停止读取',502);}chunks.push(part.value);}
        const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(this.cache.size>=200)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{until:Date.now()+(body?120000:86400000),value});return value;
      }catch(error){if(error instanceof CommunityError)throw error;this.blockedUntil=Date.now()+5000;throw new CommunityError('Bangumi 连接超时或数据异常，已有缓存不受影响',503);}
    });this.tail=operation.catch(()=>{});this.inflight.set(key,operation);operation.finally(()=>this.inflight.delete(key)).catch(()=>{});return operation;
  }
  async import(input:unknown):Promise<AnimeWork>{
    const id=subjectId(input),known=animeCatalog().find(w=>w.id===id);
    if(known?.detailFetchedAt&&Date.now()-known.detailFetchedAt<86400000)return known;
    const work=normalizeSubject(await this.request(`/subjects/${id}`));
    if(work.id!==id)throw new CommunityError('Bangumi 返回的条目 ID 不一致',502);
    work.detailFetchedAt=Date.now();
    try{const raw=await this.request(`/subjects/${id}/subjects`);if(Array.isArray(raw))work.seriesLinks=raw.filter(r=>['前传','续集','番外篇','总集篇'].includes(r.relation)&&r.type===2&&r.nsfw!==true).map(r=>r.id).filter(n=>Number.isSafeInteger(n)&&n>0).slice(0,50);}catch{/* A missing optional relation endpoint must not block a valid subject. */}
    try{await persistAnimeWorks([work]);}catch{throw new CommunityError('导入目录保存失败，请重试；已有作品池未改变',503);}return animeCatalog().find(w=>w.id===id)!;
  }
  async discover(input:unknown):Promise<AnimeDiscoveryResult>{
    const q=discoveryQuery(input);let local=q.source==='cache',notice='',works:AnimeWork[]=[],total=0,nextOffset:number|null=null;
    if(q.q&&(/^\d+$/.test(q.q)||/^https?:/.test(q.q))){const id=subjectId(q.q);let work:AnimeWork;if(q.source==='cache'){const found=animeCatalog().find(w=>w.id===id);if(!found)throw new CommunityError('缓存尚未收录此条目，请切换 Bangumi 搜索或通过 ID 导入');work=found;}else work=await this.import(id);const matches=filterAnime([work],{...q,q:undefined});return {works:matches,total:matches.length,nextOffset:null,source:q.source==='cache'?'cache':'bangumi',notice:q.source==='cache'?'按 ID 匹配服务器缓存。':'条目已导入统一服务器目录；仍需加入并保存作品池。',updatedAt:Date.now(),missingMetadata:work.type==='未知'?1:0};}
    if(!local){
      const filter:Record<string,unknown>={type:[2],nsfw:false};
      if(q.tags?.length&&q.tagMode!=='any')filter.tag=q.tags;
      const dates:string[]=[];if(q.yearFrom)dates.push(`>=${q.yearFrom}-01-01`);if(q.yearTo)dates.push(`<${q.yearTo+1}-01-01`);if(q.yearFrom&&q.yearTo===q.yearFrom&&q.quarter){dates.push(`>=${q.yearFrom}-${String(q.quarter*3-2).padStart(2,'0')}-01`,`<${q.quarter===4?q.yearFrom+1:q.yearFrom}-${String(q.quarter===4?1:q.quarter*3+1).padStart(2,'0')}-01`);}if(dates.length)filter.air_date=dates;
      if(q.minRating)filter.rating=[`>=${q.minRating}`];if(q.minVotes)filter.rating_count=[`>=${q.minVotes}`];
      try{
        const result=record(await this.request(`/search/subjects?limit=24&offset=${q.offset}`,{keyword:q.q??'',sort:q.sort==='recent'?'match':q.sort,filter}));
        if(!Array.isArray(result.data)||result.data.length>50)throw new CommunityError('Bangumi 搜索数据格式异常',502);
        const normalized:AnimeWork[]=[];for(const row of result.data){try{normalized.push(normalizeSubject(row));}catch{/* Exclude invalid / non-animation / adult entries. */}}
        if(normalized.length)await persistAnimeWorks(normalized);
        works=normalized.map(w=>animeCatalog().find(c=>c.id===w.id)!);total=number(result.total,1e9)??works.length;
        nextOffset=result.data.length&&q.offset!+24<Math.min(total,2000)?q.offset!+24:null;
        notice='Bangumi 原始结果每页 24 条；形式、标签“或”、跨年季度及最新排序在本页元数据内生效，可继续加载。缺失元数据不会冒充 0 分或 TV。';
        // Remote relevance is authoritative: aliases need not be repeated in a lightweight response.
        works=sortWorks(filterAnime(works,{...q,q:undefined}),q);
      }catch(error){if(!(error instanceof CommunityError)||error.status<500)throw error;local=true;notice=`${error.message}。当前展示服务器缓存，范围不等于完整 Bangumi。`;}
    }
    if(local){const filtered=sortWorks(filterAnime([...animeCatalog()],q),q);total=filtered.length;works=filtered.slice(q.offset,q.offset!+24);nextOffset=q.offset!+24<total?q.offset!+24:null;notice||='仅筛选服务器已缓存作品；旧条目的评分、标签或媒介元数据可能不足。';}
    return {works,total,nextOffset,source:local?'cache':'bangumi',notice,updatedAt:Date.now(),missingMetadata:works.filter(w=>w.rating==null||!w.tags||w.type==='未知').length};
  }
}
