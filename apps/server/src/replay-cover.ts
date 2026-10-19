/** Only a server-held public replay card may select the URL; never accept a URL from the request. */
export async function fetchReplayCover(source: string, fetcher: typeof fetch = fetch, timeoutMs = 4500) {
  const url=new URL(source);
  if(url.protocol!=='https:'||!['lain.bgm.tv','lain.bangumi.tv'].includes(url.hostname)||url.username||url.password||url.port)throw new Error('封面来源不可导出');
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{'User-Agent':'Cipai-Replay/1.0'}});
  const type=response.headers.get('content-type')?.split(';')[0]??'';
  if(!response.ok||!['image/jpeg','image/png','image/webp'].includes(type)||!response.body)throw new Error('封面暂不可用');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw new Error('封面过大');chunks.push(value);}}finally{await reader.cancel();}
  return {type,data:Buffer.concat(chunks)};
}
