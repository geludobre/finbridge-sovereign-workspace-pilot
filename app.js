"use strict";
const DBNAME="finbridge-sovereign-v2-local";
const te=new TextEncoder(),td=new TextDecoder();
let db=null,session=null,current=null,dirty=false,worker=null,taskNumber=0;
const $=id=>document.getElementById(id);
const STORAGE_LIMIT=100,MIN_PASSWORD=14,IDLE_MS=15*60*1000;

function msg(id,text,isError=false){
 const el=$(id);el.textContent=text;el.classList.toggle("error",!!isError);
}
function randomB64(size){return b64(crypto.getRandomValues(new Uint8Array(size)));}
function b64(bytes){
 const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
 let str="";for(let i=0;i<a.length;i+=32768)str+=String.fromCharCode(...a.slice(i,i+32768));
 return btoa(str);
}
function unb64(value){const raw=atob(value);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function transaction(name,mode,action){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(name,mode),store=tx.objectStore(name);
  let value;
  try{action(store, v=>value=v);}catch(e){tx.abort();reject(e);return;}
  tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||new Error("Eroare de stocare"));tx.onabort=()=>reject(tx.error||new Error("Stocare întreruptă"));
 });
}
function requestRead(store,req,set){req.onsuccess=()=>set(req.result);req.onerror=()=>{};}
function read(store,key){return transaction(store,"readonly",(s,set)=>requestRead(s,s.get(key),set));}
function allOwned(username){
 return transaction("docs","readonly",(s,set)=>requestRead(s,s.index("owner").getAll(username),set));
}
function write(store,item){return transaction(store,"readwrite",s=>s.put(item));}
function del(store,key){return transaction(store,"readwrite",s=>s.delete(key));}

function openDB(){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DBNAME,1);
  req.onupgradeneeded=()=>{
   const d=req.result;
   if(!d.objectStoreNames.contains("accounts"))d.createObjectStore("accounts",{keyPath:"username"});
   if(!d.objectStoreNames.contains("docs")){
    const s=d.createObjectStore("docs",{keyPath:"key"});
    s.createIndex("owner","owner",{unique:false});
   }
  };
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
  req.onblocked=()=>reject(new Error("Baza locală este deschisă de altă fereastră"));
 });
}
async function derive(password,salt){
 const root=await crypto.subtle.importKey("raw",te.encode(password),"PBKDF2",false,["deriveKey"]);
 return crypto.subtle.deriveKey({name:"PBKDF2",salt:unb64(salt),iterations:600000,hash:"SHA-256"},
 root,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function seal(key,value,aad){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=te.encode(JSON.stringify(value));
 const enc=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:te.encode(aad)},key,bytes);
 return {iv:b64(iv),cipher:b64(enc)};
}
async function unseal(key,item,aad){
 const result=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(item.iv),additionalData:te.encode(aad)},key,unb64(item.cipher));
 return JSON.parse(td.decode(result));
}
function usernameValue(){
 const name=$("username").value.trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9._-]{2,40}$/.test(name))throw Error("Profilul trebuie să aibă 3–41 caractere: litere mici, cifre, ., _ sau -");
 return name;
}
function passwordValue(){return $("password").value;}
function btnBusy(on){
 for(const id of ["create-account","unlock"]){$(id).disabled=on;}
}
async function createAccount(){
 if(session)throw Error("Blochează mai întâi sesiunea curentă");
 const username=usernameValue(),password=passwordValue();
 if(password.length<MIN_PASSWORD)throw Error("Folosește o parolă de cel puțin 14 caractere");
 if(await read("accounts",username))throw Error("Profilul există deja pe acest dispozitiv");
 btnBusy(true);
 try{
  const salt=randomB64(16),key=await derive(password,salt);
  const verifier=await seal(key,{proof:"FINBRIDGE-LOCAL-VAULT-v2",username},"account:"+username);
  await write("accounts",{username,salt,verifier,schema:2,created:Date.now()});
  $("password").value="";session={username,key,lastTouch:Date.now()};
  await showWorkspace();
  msg("workspace-message","Seiful criptat local a fost creat. Exportă un backup criptat.");
 }finally{btnBusy(false);}
}
async function unlock(){
 if(session)throw Error("O sesiune este deja deblocată");
 const username=usernameValue(),password=passwordValue();
 if(!password)throw Error("Introduce parola");
 const account=await read("accounts",username);
 if(!account){throw Error("Profilul nu există pe acest dispozitiv. Pentru alt dispozitiv, importă întâi backup-ul criptat.");}
 btnBusy(true);
 try{
  const key=await derive(password,account.salt);
  let proof;
  try{proof=await unseal(key,account.verifier,"account:"+username);}catch{throw Error("Parolă incorectă sau profil deteriorat");}
  if(proof.proof!=="FINBRIDGE-LOCAL-VAULT-v2"||proof.username!==username)throw Error("Integritatea profilului nu a putut fi verificată");
  $("password").value="";
  session={username,key,lastTouch:Date.now()};
  await showWorkspace();
 }finally{btnBusy(false);}
}
function lock(){
 if(!session)return;
 session=null;current=null;dirty=false;worker?.terminate();worker=null;
 $("project-body").value="";$("project-title").value="";$("password").value="";
 $("workspace").classList.add("hidden");$("identity").classList.remove("hidden");
 msg("identity-message","Sesiunea este blocată. Cheia nu mai este păstrată de aplicație.");
}
function touch(){if(session)session.lastTouch=Date.now();}
function requireSession(){if(!session)throw Error("Seiful este blocat");touch();return session;}
async function decodeDocs(){
 const ss=requireSession(),rows=await allOwned(ss.username),documents=[];
 for(const row of rows){
  try{
   const obj=await unseal(ss.key,row,"doc:"+ss.username+":"+row.id);
   if(obj.id!==row.id||typeof obj.title!=="string"||typeof obj.body!=="string")throw Error("record mismatch");
   documents.push(obj);
  }catch{throw Error("Un proiect nu trece verificarea de integritate AES-GCM. Nu s-au modificat datele.");}
 }
 return documents.sort((a,b)=>b.updated-a.updated);
}
async function showWorkspace(){
 $("identity").classList.add("hidden");$("workspace").classList.remove("hidden");
 $("session-heading").textContent="Seif: "+session.username;
 $("node").textContent="Acest dispozitiv";
 $("project-title").value="";$("project-body").value="";
 current=null;dirty=false;
 await renderDocs();
}
async function renderDocs(){
 const docs=await decodeDocs(),container=$("project-list");
 $("count").textContent=String(docs.length);container.replaceChildren();
 if(!docs.length){
  const el=document.createElement("p");el.className="empty";el.textContent="Niciun proiect în acest seif local.";container.append(el);
 }
 for(const doc of docs){
  const button=document.createElement("button");button.className="project-item";
  if(current&&doc.id===current.id)button.classList.add("selected");
  const name=document.createElement("span");name.textContent=doc.title||"Fără titlu";
  const date=document.createElement("small");date.textContent=new Date(doc.updated).toLocaleString("ro-RO");
  button.append(name,date);
  button.addEventListener("click",()=>run(()=>selectDoc(doc)));
  container.append(button);
 }
}
async function selectDoc(doc){
 requireSession();
 if(dirty&&!confirm("Există modificări nesalvate. Continui fără salvare?"))return;
 current={...doc};dirty=false;
 $("project-title").value=current.title;$("project-body").value=current.body;
 $("analysis-result").textContent="";
 await renderDocs();msg("workspace-message","");
}
async function newDoc(){
 requireSession();
 if(dirty&&!confirm("Ignori modificările nesalvate?"))return;
 current={id:crypto.randomUUID(),title:"",body:"",created:Date.now(),updated:Date.now()};
 $("project-title").value="";$("project-body").value="";
 $("analysis-result").textContent="";dirty=false;
 msg("workspace-message","Proiect nou: introdu titlul și salvează-l local.");
 await renderDocs();$("project-title").focus();
}
async function saveDoc(){
 const ss=requireSession();
 if(!current)throw Error("Creează sau selectează un proiect");
 const docs=await allOwned(ss.username);
 if(docs.length>=STORAGE_LIMIT&&!docs.some(d=>d.id===current.id))throw Error("Limită locală: maximum 100 de proiecte");
 const title=$("project-title").value.trim(),body=$("project-body").value;
 if(!title)throw Error("Titlul este obligatoriu");
 if(title.length>120||body.length>100000)throw Error("Proiectul depășește limita de dimensiune");
 const item={id:current.id,title,body,created:current.created,updated:Date.now()};
 const enc=await seal(ss.key,item,"doc:"+ss.username+":"+item.id);
 await write("docs",{key:ss.username+":"+item.id,owner:ss.username,id:item.id,...enc});
 current=item;dirty=false;
 await renderDocs();
 msg("workspace-message","Proiect salvat și criptat local. Niciun upload către LMint.");
}
async function deleteDoc(){
 const ss=requireSession();
 if(!current)throw Error("Selectează un proiect");
 if(!confirm("Ștergi definitiv acest proiect doar de pe acest dispozitiv?"))return;
 await del("docs",ss.username+":"+current.id);
 current=null;dirty=false;$("project-title").value="";$("project-body").value="";
 $("analysis-result").textContent="";await renderDocs();
 msg("workspace-message","Proiect șters local.");
}
async function analyze(){
 requireSession();
 const title=$("project-title").value,body=$("project-body").value;
 if(!worker)worker=new Worker("./worker.js");
 const id=++taskNumber;
 const result=await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{worker.removeEventListener("message",handler);reject(Error("Timpul de analiză a expirat"));},4000);
  function handler(event){
   if(event.data?.id!==id)return;
   clearTimeout(timeout);worker.removeEventListener("message",handler);
   event.data.error?reject(Error(event.data.error)):resolve(event.data.result);
  }
  worker.addEventListener("message",handler);
  worker.postMessage({id,title,text:body});
 });
 $("analysis-result").textContent="Analiză executată pe acest dispozitiv: "+result.words+" cuvinte · "+result.lines+" rânduri · "+result.tasks+" sarcini checklist ("+result.checked+" bifate) · "+result.headings+" subtitluri.";
}
function download(content,filename){
 const blob=new Blob([content],{type:"application/json"}),url=URL.createObjectURL(blob);
 const a=document.createElement("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function exportEncrypted(){
 const ss=requireSession(),account=await read("accounts",ss.username),docs=await allOwned(ss.username);
 const bundle={format:"finbridge.sovereign.encrypted-backup.v2",exported:Date.now(),account,docs};
 const payload=JSON.stringify(bundle);
 if(payload.length>15_000_000)throw Error("Backupul depășește limita de 15 MB");
 download(payload,"finbridge-sovereign-"+ss.username+"-encrypted.json");
 msg("workspace-message","Backup criptat exportat. Păstrează parola separat.");
}
function validRecord(row,username){
 if(!row||typeof row!=="object"||row.owner!==username||!/^[-a-f0-9]{36}$/i.test(row.id||"")||
 row.key!==username+":"+row.id||typeof row.iv!=="string"||typeof row.cipher!=="string"||
 row.iv.length!==16||row.cipher.length>300000)return false;
 return true;
}
async function importEncrypted(file){
 if(!file) return;
 if(file.size>15_000_000)throw Error("Backup prea mare (maximum 15 MB)");
 const backup=JSON.parse(await file.text());
 if(backup.format!=="finbridge.sovereign.encrypted-backup.v2"||!backup.account||
 !Array.isArray(backup.docs)||backup.docs.length>STORAGE_LIMIT)throw Error("Format de backup invalid");
 const a=backup.account;
 if(typeof a.username!=="string"||!(/^[a-z0-9][a-z0-9._-]{2,40}$/.test(a.username))||
 typeof a.salt!=="string"||a.salt.length!==24||!a.verifier||
 typeof a.verifier.iv!=="string"||typeof a.verifier.cipher!=="string")throw Error("Cont invalid în backup");
 if(!backup.docs.every(d=>validRecord(d,a.username)))throw Error("Proiecte invalide în backup");
 const uniq=new Set(backup.docs.map(d=>d.key));
 if(uniq.size!==backup.docs.length)throw Error("Backup conține duplicate");
 const existing=await read("accounts",a.username);
 if(existing){
  if(existing.salt!==a.salt||existing.verifier.cipher!==a.verifier.cipher)throw Error("Profilul local are altă cheie. Nu poate fi suprascris.");
  if(!session||session.username!==a.username)throw Error("Deblochează profilul local înainte de import.");
 }else if(session)throw Error("Blochează sesiunea înainte de a restaura alt profil");
 await new Promise((resolve,reject)=>{
  const tx=db.transaction(["accounts","docs"],"readwrite");
  if(!existing)tx.objectStore("accounts").put(a);
  for(const d of backup.docs)tx.objectStore("docs").put(d);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Import anulat"));
 });
 if(session){await renderDocs();msg("workspace-message","Backup importat și păstrat criptat.");}
 else{ $("username").value=a.username;msg("identity-message","Backup criptat importat. Deblochează cu parola originală.");}
}
async function deleteAccount(){
 const ss=requireSession();
 const reply=prompt("Această operație șterge definitiv acest profil și toate proiectele locale. Pentru confirmare, scrie exact numele profilului: "+ss.username);
 if(reply!==ss.username){msg("workspace-message","Ștergerea a fost anulată.");return;}
 const rows=await allOwned(ss.username);
 await new Promise((resolve,reject)=>{
  const tx=db.transaction(["accounts","docs"],"readwrite");
  for(const row of rows)tx.objectStore("docs").delete(row.key);
  tx.objectStore("accounts").delete(ss.username);
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Ștergere anulată"));
 });
 lock();$("username").value="";
 msg("identity-message","Seiful și proiectele sale au fost șterse local. Copiile de backup exportate anterior nu sunt afectate.");
}
function run(fn){Promise.resolve().then(fn).catch(e=>{console.error("Local operation error:",e.name);msg(session?"workspace-message":"identity-message",e.message||"Operație eșuată",true);});}
async function boot(){
 if(window.top!==window.self)throw Error("Aplicația nu poate fi inclusă într-un iframe");
 if(!window.isSecureContext||!crypto.subtle||!window.indexedDB)throw Error("Browserul nu acceptă Web Crypto/IndexedDB în context securizat");
 db=await openDB();
 $("create-account").onclick=()=>run(createAccount);
 $("unlock").onclick=()=>run(unlock);
 $("clear-fields").onclick=()=>{$("username").value="";$("password").value="";};
 $("lock").onclick=lock;
 $("new-project").onclick=()=>run(newDoc);
 $("save-project").onclick=()=>run(saveDoc);
 $("delete-project").onclick=()=>run(deleteDoc);
 $("analyze").onclick=()=>run(analyze);
 $("export").onclick=()=>run(exportEncrypted);
 $("delete-account").onclick=()=>run(deleteAccount);
 $("import-file").onchange=e=>run(async()=>{await importEncrypted(e.target.files[0]);e.target.value="";});
 $("import-locked").onchange=e=>run(async()=>{await importEncrypted(e.target.files[0]);e.target.value="";});
 $("project-title").addEventListener("input",()=>{dirty=true;touch();});
 $("project-body").addEventListener("input",()=>{dirty=true;touch();});
 ["keydown","pointerdown"].forEach(type=>document.addEventListener(type,touch,{passive:true}));
 window.addEventListener("beforeunload",e=>{if(dirty&&session){e.preventDefault();e.returnValue="";}});
 window.addEventListener("online",connection);window.addEventListener("offline",connection);
 setInterval(()=>{if(session&&Date.now()-session.lastTouch>IDLE_MS)lock();},20000);
 if("serviceWorker"in navigator){navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"}).catch(()=>{});}
 connection();msg("identity-message","Pregătit. Datele sunt locale acestui profil de browser.");
}
function connection(){$("connection").textContent=navigator.onLine?"Browser conectat · date locale":"Offline · date locale";}
document.addEventListener("DOMContentLoaded",()=>boot().catch(e=>{msg("identity-message",e.message,true);$("create-account").disabled=true;$("unlock").disabled=true;}));