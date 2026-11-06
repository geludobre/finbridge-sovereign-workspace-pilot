"use strict";
self.onmessage=(event)=>{
 const {id,title,text}=event.data||{};
 if(typeof title!=="string"||typeof text!=="string"||text.length>100000){self.postMessage({id,error:"Invalid local task"});return;}
 const words=(title+" "+text).trim().split(/\s+/u).filter(Boolean).length;
 const lines=text.split(/\r?\n/u).filter(line=>line.trim());
 const tasks=lines.filter(line=>/^\s*[-*]\s*\[[ xX]\]/u.test(line)).length;
 const checked=lines.filter(line=>/^\s*[-*]\s*\[[xX]\]/u.test(line)).length;
 const headings=lines.filter(line=>/^\s*#{1,6}\s+/u.test(line)).length;
 self.postMessage({id,result:{words,lines:lines.length,tasks,checked,headings,characters:text.length}});
};