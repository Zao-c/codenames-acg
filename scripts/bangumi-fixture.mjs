// Deterministic browser-test upstream only. Loaded explicitly through Node --import by the test runner.
const native=globalThis.fetch;
const works=Array.from({length:48},(_,i)=>({id:800001+i,type:2,nsfw:false,name:`Test Star ${String(i+1).padStart(2,'0')}`,name_cn:`测试星图 ${String(i+1).padStart(2,'0')}`,platform:i%4===1?'剧场版':i%4===2?'OVA':i%4===3?'ONA':'TV',date:`${2020+i%3}-${i%2?'10':'04'}-01`,rating:{score:8+i%10/10,total:1200+i*100},tags:[{name:i%2?'日常':'科幻'},{name:'冒险'}],images:{},infobox:[{key:'别名',value:[{v:`Test alias ${i+1}`}]}],collection:{collect:1000+i*20}}));
globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input));if(url.origin!=='https://api.bgm.tv')return native(input,init);
  if(url.pathname==='/v0/search/subjects'){
    const body=JSON.parse(String(init?.body)),q=body.keyword||'';
    if(q==='upstream-offline')return Response.json({message:'fixture outage'},{status:503});
    let rows=works.filter(w=>`${w.name} ${w.name_cn} ${w.infobox[0].value[0].v}`.toLowerCase().includes(q.toLowerCase()));
    if(body.sort==='score')rows.sort((a,b)=>b.rating.score-a.rating.score);
    if(body.sort==='heat')rows.sort((a,b)=>b.collection.collect-a.collection.collect);
    const offset=Number(url.searchParams.get('offset')||0);return Response.json({total:rows.length,data:rows.slice(offset,offset+24)});
  }
  const id=Number(/subjects\/(\d+)/.exec(url.pathname)?.[1]);
  if(url.pathname.endsWith('/subjects'))return Response.json(id===800049?[{id:800001,type:2,relation:'续集'}]:[]);
  if(id===800099)return Response.json({message:'not found'},{status:404});
  if(id===800098)return Response.json({...works[0],id,type:1});
  return Response.json(works.find(w=>w.id===id)??{...works[0],id,name:`Imported ${id}`,name_cn:`测试导入 ${id}`});
};
