// Chromium does not automatically use the proxy variables used by Node fetch.
// Keep local test traffic direct; never log proxy credentials.
export function browserProxy(){
  const value=process.env.https_proxy??process.env.HTTPS_PROXY??process.env.http_proxy??process.env.HTTP_PROXY;
  if(!value)return {};
  const url=new URL(value);
  return {proxy:{server:url.protocol+'//'+url.host,bypass:'127.0.0.1,localhost',...(url.username?{username:decodeURIComponent(url.username),password:decodeURIComponent(url.password)}:{})}};
}
