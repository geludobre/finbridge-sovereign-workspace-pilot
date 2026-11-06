"use strict";
const VERSION="finbridge-sovereign-v2-shell-20261106-v3";
const SHELL=["./","./index.html","./style.css","./app.js","./worker.js","./privacy.html"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(async keys=>{for(const k of keys){if(k.startsWith("finbridge-sovereign-v2-")&&k!==VERSION)await caches.delete(k);}}).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
 const request=event.request;
 if(request.method!=="GET"||new URL(request.url).origin!==self.location.origin)return;
 event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(response=>response.ok?response:new Response("Offline",{status:503})).catch(()=>new Response("Offline",{status:503}))));
});