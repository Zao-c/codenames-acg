// CDP emits plain records. Subscribing to every Playwright Request/Response retains
// thousands of channel objects until its bucket GC, exhausting a 192 MiB driver.
// Observe the same traffic without refreshing pages or resetting player sessions.
export async function observeSoakNetwork(cdp,{onCatalog=()=>{},onImage=()=>{},onPacket=()=>{}}={}){
 const pending=new Map();
 const start=event=>{
  const {requestId,request,type,timestamp}=event;
  if(new URL(request.url).pathname==='/api/anime/catalog')onCatalog();
  if(type==='Image'||request.url.includes('/socket.io/')&&request.method==='GET')
   pending.set(requestId,{url:request.url,image:type==='Image',started:timestamp});
 };
 const response=event=>{
  const item=pending.get(event.requestId);
  if(item?.image)onImage({url:item.url,status:event.response.status,ms:(event.timestamp-item.started)*1000});
 };
 const finished=async event=>{
  const item=pending.get(event.requestId);pending.delete(event.requestId);
  if(item&&!item.image)try{
   const result=await cdp.send('Network.getResponseBody',{requestId:event.requestId});
   const body=result.base64Encoded?Buffer.from(result.body,'base64').toString():result.body;
   for(const packet of body.split('\x1e'))onPacket(packet);
  }catch{} // A navigation may discard a completed polling response.
 };
 const failed=event=>{
  const item=pending.get(event.requestId);pending.delete(event.requestId);
  if(item?.image&&!event.canceled&&!event.errorText?.includes('ERR_ABORTED'))onImage({url:item.url,error:event.errorText});
 };
 const listeners={'Network.requestWillBeSent':start,'Network.responseReceived':response,'Network.loadingFinished':finished,'Network.loadingFailed':failed};
 for(const [event,listener] of Object.entries(listeners))cdp.on(event,listener);
 await cdp.send('Network.enable');
 return {pending:()=>pending.size,dispose:()=>{for(const [event,listener] of Object.entries(listeners))cdp.off(event,listener);pending.clear();}};
}
