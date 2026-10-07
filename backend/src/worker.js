const MAX_FILE = 8 * 1024 * 1024;
const MAX_BODY = 4 * MAX_FILE + 65536;
const ID = /^[a-f0-9]{32}$/;
export function imageType(b) {
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => b[i] === v)) return 'image/png';
  if (b.length >= 12 && String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}
async function authorized(request, env) {
  if (!env.OWNER_PASSWORD || env.OWNER_PASSWORD.length < 20) return false;
  const input = request.headers.get('Authorization') || '';
  const digest = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const a = await digest(input), b = await digest(`Bearer ${env.OWNER_PASSWORD}`);
  return a.reduce((v,n,i) => v | (n ^ b[i]), 0) === 0;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = {'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN, 'Vary':'Origin', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'X-Robots-Tag':'noindex, nofollow'};
    const json = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
    if (origin && origin !== env.ALLOWED_ORIGIN) return json({error:'許可されていないサイトからの操作です。'},403);
    if (request.method === 'OPTIONS') return new Response(null, {status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'86400'}});
    try {
      const path = new URL(request.url).pathname;
      if (request.method === 'POST' && path === '/posts') {
        if (!(await authorized(request,env))) return json({error:'管理パスワードを確認してください。'},401);
        if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data')) return json({error:'写真を選択してください。'},400);
        if (Number(request.headers.get('Content-Length')) > MAX_BODY) return json({error:'写真の容量が大きすぎます。'},413);
        // Content-Length がなくても、メモリに取り込むサイズを制限する。
        const reader = request.body?.getReader();
        if (!reader) return json({error:'写真を選択してください。'},400);
        let size=0; const chunks=[];
        while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>MAX_BODY){await reader.cancel();return json({error:'写真の容量が大きすぎます。'},413);} chunks.push(value); }
        const data = await new Response(new Blob(chunks),{headers:{'Content-Type':request.headers.get('Content-Type')}}).formData();
        const files = data.getAll('photos');
        if (files.length < 1 || files.length > 4) return json({error:'写真は1〜4枚まで掲載できます。'},400);
        const valid=[];
        for (const file of files) {
          if (!(file instanceof File) || file.size === 0 || file.size > MAX_FILE) return json({error:'写真は1枚8MBまでです。'},400);
          const bytes = new Uint8Array(await file.arrayBuffer());
          const type=imageType(bytes);
          if (!type || type !== file.type) return json({error:'JPEG・PNG・WebPの写真のみ掲載できます。'},400);
          valid.push({bytes,type});
        }
        const id=crypto.randomUUID().replaceAll('-','');
        const keys=[];
        try {
          for(let i=0;i<valid.length;i++) { const key=`photos/${id}/${i}`; keys.push(key); await env.PHOTOS.put(key,valid[i].bytes,{httpMetadata:{contentType:valid[i].type}}); }
          await env.PHOTOS.put(`posts/${id}`,JSON.stringify({id,count:valid.length,createdAt:new Date().toISOString()}));
        } catch (err) { await env.PHOTOS.delete(keys).catch(()=>{}); throw err; }
        return json({id},201);
      }
      const match=path.match(/^\/posts\/([a-f0-9]{32})(?:\/images\/([0-3]))?$/);
      if (!match || !ID.test(match[1])) return json({error:'ページが見つかりません。'},404);
      const [,id,index]=match;
      // 削除は存在確認より先に認証する。
      if (request.method==='DELETE' && !(await authorized(request,env))) return json({error:'管理パスワードを確認してください。'},401);
      const obj=await env.PHOTOS.get(`posts/${id}`);
      if (!obj) return json({error:'この投稿は見つからないか、削除されています。'},404);
      const post=await obj.json();
      if(request.method==='GET' && index===undefined) return json(post);
      if(request.method==='GET' && index!==undefined && Number(index)<post.count) {
        const photo=await env.PHOTOS.get(`photos/${id}/${index}`);
        if(!photo) return json({error:'写真が見つかりません。'},404);
        return new Response(photo.body,{headers:{...headers,'Content-Type':photo.httpMetadata.contentType,'Content-Disposition':'inline'}});
      }
      if(request.method==='DELETE' && index===undefined) {
        // 全写真を削除できるまでmanifestを残す。失敗時は再試行可能。
        await env.PHOTOS.delete(Array.from({length:post.count},(_,i)=>`photos/${id}/${i}`));
        await env.PHOTOS.delete(`posts/${id}`);
        return json({deleted:true});
      }
      return json({error:'この操作には対応していません。'},405);
    } catch { return json({error:'処理できませんでした。少し待ってからもう一度お試しください。'},500); }
  }
};
