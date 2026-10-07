import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../backend/src/worker.js';
const password='test-password-at-least-20-characters';
class Bucket {
  data=new Map();failPut=false;
  async put(k,v,o){if(this.failPut && k.startsWith('posts/'))throw Error('fail');this.data.set(k,{v,o});}
  async get(k){const x=this.data.get(k);return x?{json:async()=>JSON.parse(x.v),body:x.v,httpMetadata:x.o?.httpMetadata}:null;}
  async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])this.data.delete(k);}
}
const env=()=>({OWNER_PASSWORD:password,ALLOWED_ORIGIN:'https://test.github.io',PHOTOS:new Bucket()});
function request(path,method='GET',body,auth=password){return new Request('https://api.example'+path,{method,body,headers:{Origin:'https://test.github.io',...(auth?{Authorization:'Bearer '+auth}:{})}});}
function form(n=1,type='image/png',bytes=new Uint8Array([137,80,78,71,13,10,26,10,0])){const f=new FormData();for(let i=0;i<n;i++)f.append('photos',new Blob([bytes],{type}),'photo.png');return f;}
test('upload → public metadata and image → owner deletion',async()=>{const e=env();let r=await worker.fetch(request('/posts','POST',form(4)),e);assert.equal(r.status,201);const {id}=await r.json();assert.match(id,/^[a-f0-9]{32}$/);r=await worker.fetch(request('/posts/'+id,'GET',undefined,null),e);assert.equal((await r.json()).count,4);r=await worker.fetch(request('/posts/'+id+'/images/0','GET',undefined,null),e);assert.equal(r.headers.get('Content-Type'),'image/png');assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal((await r.arrayBuffer()).byteLength,9);assert.equal((await worker.fetch(request('/posts/'+id,'DELETE',undefined,'wrong'),e)).status,401);assert.equal((await worker.fetch(request('/posts/'+id,'DELETE'),e)).status,200);assert.equal(e.PHOTOS.data.size,0);assert.equal((await worker.fetch(request('/posts/'+id),e)).status,404);});
test('reject zero/five files, unsupported and spoofed types',async()=>{for(const body of [form(0),form(5),form(1,'text/plain'),form(1,'image/png',new TextEncoder().encode('<script>'))]){const e=env();assert.equal((await worker.fetch(request('/posts','POST',body),e)).status,400);assert.equal(e.PHOTOS.data.size,0);}});
test('owner auth and exact origin enforced',async()=>{const e=env();assert.equal((await worker.fetch(request('/posts','POST',form(),null),e)).status,401);const r=new Request('https://api.example/posts',{method:'POST',headers:{Origin:'https://evil.example'},body:form()});assert.equal((await worker.fetch(r,e)).status,403);e.OWNER_PASSWORD='';assert.equal((await worker.fetch(request('/posts','POST',form()),e)).status,401);});
test('partial failed upload cleaned up',async()=>{const e=env();e.PHOTOS.failPut=true;assert.equal((await worker.fetch(request('/posts','POST',form(2)),e)).status,500);assert.equal(e.PHOTOS.data.size,0);});
test('file size bounded and preflight supported',async()=>{const e=env();const big=form(1,'image/png',new Uint8Array(8*1024*1024+1));assert.equal((await worker.fetch(request('/posts','POST',big),e)).status,400);assert.equal((await worker.fetch(request('/posts','OPTIONS'),e)).status,204);});
