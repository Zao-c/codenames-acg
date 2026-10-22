import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
const root=path.resolve(process.env.SOAK_WEB_DIST??'apps/web/dist'),backend=Number(process.env.SOAK_BACKEND_PORT??3194),port=Number(process.env.SOAK_WEB_PORT??5394);
const coverBackend=Number(process.env.SOAK_COVER_PORT??0);
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
 if(/^\/(api\/|socket\.io\/|health(?:\?|$)|rooms(?:\?|$))/.test(req.url??'')){
  const upstream=http.request({host:'127.0.0.1',port:coverBackend&&/^\/api\/anime\/(cover-locations(?:\?|$)|cover\/)/.test(req.url??'')?coverBackend:backend,path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.on('aborted',()=>upstream.destroy());req.pipe(upstream);return;
 }
 let filename;try{filename=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));}catch{res.writeHead(400).end();return;}
 if(filename!==root&&!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 if(!fs.existsSync(filename)||!fs.statSync(filename).isFile())filename=path.join(root,'index.html');
 res.setHeader('Content-Type',mime[path.extname(filename)]??'application/octet-stream');res.setHeader('Cache-Control',filename.endsWith('index.html')?'no-store':'public, max-age=3600');fs.createReadStream(filename).on('error',()=>res.end()).pipe(res);
});
server.on('upgrade',(req,socket,head)=>{
 if(!req.url?.startsWith('/socket.io/')){socket.destroy();return;}
 const upstream=net.connect(backend,'127.0.0.1',()=>{upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+req.rawHeaders.reduce((s,v,i)=>s+(i%2?v+'\r\n':v+': '),'')+'\r\n');if(head.length)upstream.write(head);upstream.pipe(socket);socket.pipe(upstream);});
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
});
server.listen(port,'127.0.0.1',()=>console.log(`Isolated compiled web proxy http://127.0.0.1:${port}`));
