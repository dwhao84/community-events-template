import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../src/worker.js';

test('HTTP redirects to HTTPS with the same path and query and common security headers',async()=>{
 const result=await handle(new Request('http://events.example.org/about?x=1'),{});
 assert.equal(result.status,308);
 assert.equal(result.headers.get('Location'),'https://events.example.org/about?x=1');
 assert.equal(result.headers.get('Strict-Transport-Security'),'max-age=86400');
 assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');
 assert.equal(result.headers.get('Referrer-Policy'),'strict-origin-when-cross-origin');
 assert.match(result.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.equal(result.headers.get('Permissions-Policy'),'camera=(), microphone=(), geolocation=()');
});

test('HTTP POST redirects with 308 before parsing a body or accessing application services',async()=>{
 const result=await handle(new Request('http://events.example.org/api/sessions/test/registrations?x=1',{
  method:'POST',headers:{'Content-Type':'application/json'},body:'invalid JSON',
 }),{});
 assert.equal(result.status,308);
 assert.equal(result.headers.get('Location'),'https://events.example.org/api/sessions/test/registrations?x=1');
});

for(const host of ['localhost','127.0.0.1','[::1]']){
 test(`loopback HTTP on ${host} still reaches assets without redirecting`,async()=>{
  const req=new Request(`http://${host}:8787/`);
  const result=await handle(req,{ASSETS:{fetch:async incoming=>{
   assert.equal(incoming,req);
   return new Response('local page');
  }}});
  assert.equal(result.status,200);
  assert.equal(result.headers.get('Location'),null);
  assert.equal(await result.text(),'local page');
 });
}

test('HTTPS still reaches assets with the original request and response status',async()=>{
 const req=new Request('https://events.example.org/about?x=1');
 const result=await handle(req,{ASSETS:{fetch:async incoming=>{
  assert.equal(incoming,req);
  return new Response('page',{status:200,headers:{'Content-Type':'text/html'}});
 }}});
 assert.equal(result.status,200);
 assert.equal(result.headers.get('Location'),null);
 assert.equal(result.headers.get('Content-Type'),'text/html');
 assert.equal(await result.text(),'page');
});

test('HTTP preserves encoded paths and repeated query values',async()=>{
 const result=await handle(new Request('http://events.example.org/a%2Fb?x=1&x=2&q=%E9%87%8C%E6%B0%91'),{});
 assert.equal(result.status,308);
 assert.equal(result.headers.get('Location'),'https://events.example.org/a%2Fb?x=1&x=2&q=%E9%87%8C%E6%B0%91');
});

test('loopback-like public hostnames are still redirected',async()=>{
 for(const host of ['localhost.example.com','127.0.0.1.example.com']){
  const result=await handle(new Request(`http://${host}/`),{});
  assert.equal(result.status,308);
  assert.equal(result.headers.get('Location'),`https://${host}/`);
 }
});

test('development HTTP on a LAN address reaches assets without redirecting',async()=>{
 const req=new Request('http://192.168.1.20:8787/');
 const result=await handle(req,{APP_ENV:'development',ASSETS:{fetch:async()=>new Response('lan page')}});
 assert.equal(result.status,200);
 assert.equal(result.headers.get('Location'),null);
 assert.equal(await result.text(),'lan page');
});

test('production and staging HTTP on a LAN address still redirect',async()=>{
 for(const APP_ENV of ['production','staging']){
  const result=await handle(new Request('http://192.168.1.20:8787/'),{APP_ENV});
  assert.equal(result.status,308);
  assert.equal(result.headers.get('Location'),'https://192.168.1.20:8787/');
 }
});

test('production HTTP on the public domain redirects',async()=>{
 const result=await handle(new Request('http://events.example.org/'),{APP_ENV:'production'});
 assert.equal(result.status,308);
 assert.equal(result.headers.get('Location'),'https://events.example.org/');
});

test('a trailing-dot localhost hostname is not treated as loopback',async()=>{
 const result=await handle(new Request('http://localhost./'),{APP_ENV:'production'});
 assert.equal(result.status,308);
 assert.equal(result.headers.get('Location'),'https://localhost./');
});
