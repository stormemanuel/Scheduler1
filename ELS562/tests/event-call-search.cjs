const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const js=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exportsObject={};vm.runInNewContext(js(fs.readFileSync(path.join(root,'lib/event-call-search.ts'),'utf8')),{exports:exportsObject});
const source=fs.readFileSync(path.join(root,'app/events/events-client.tsx'),'utf8'),ast=ts.createSourceFile('client.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),memos={};
function walk(node){if(ts.isVariableDeclaration(node)&&['eventSearchCallIds','eventSearchDays','eventSearchBoothSections'].includes(node.name.getText(ast)))memos[node.name.getText(ast)]=node.initializer.arguments[0].getText(ast);ts.forEachChild(node,walk);}walk(ast);
const days=[{id:'d1',labor_date:'2026-12-08'},{id:'d2',labor_date:'2026-12-09'}];
const rows=[{day:days[0],call:{id:'c1',area:'GENENTECH RO329294',po_number:'PO 181278',role_name:'LED Stagehand',ref:'RO329294',booth:'3812'},callAssignments:[{assignment:{},crew:{name:'Gary Smith'}}]}, {day:days[1],call:{id:'c2',area:'GENENTECH RO329294',po_number:'PO181278',role_name:'LED Stagehand',ref:'RO329294'},callAssignments:[{assignment:{},crew:{name:'Gary Smith'}},{assignment:{},crew:{name:'Colin Jones'}}]}, {day:days[0],call:{id:'c3',area:'Warehouse',po_number:'PO123',role_name:'Truck Loader',area_lead_name:'Jamie Lead'},callAssignments:[{assignment:{},crew:{name:'José Martinez'}}]}, {day:days[1],call:{id:'c4',area:'Other',po_number:'PO456',role_name:'General AV'},callAssignments:[{assignment:{privacy_hidden:true},crew:{name:'Private Person'}}]}];
const sections=[{booth:rows[0].call.area,calls:rows.slice(0,2)},{booth:'Warehouse',calls:[rows[2]]},{booth:'Other',calls:[rows[3]]}];
const ctx={...exportsObject,displayCalls:rows,appUserById:new Map(),selectedShow:{},subCallReferenceNumber:c=>c.ref,subCallBoothNumber:c=>c.booth,visibleLaborDays:days,subCallsByDayId:new Map(days.map(day=>[day.id,rows.filter(row=>row.day.id===day.id).map(row=>row.call)])),boothSections:sections};vm.createContext(ctx);
function search(query){ctx.deferredEventSubCallSearch=query;ctx.eventSubCallSearchActive=Boolean(query.trim());ctx.eventSearchCallIds=vm.runInContext(js('('+memos.eventSearchCallIds+')()'),ctx);return [...ctx.eventSearchCallIds].sort().join(',');}
let passed=0;function check(name,fn){fn();passed++;console.log('PASS '+name);}
check('RO search finds associated calls across dates',()=>assert.equal(search('RO 329294'),'c1,c2'));
check('PO search handles punctuation and spaces',()=>{assert.equal(search('po-181278'),'c1,c2');assert.equal(search('181278'),'c1,c2');});
check('area, role and booth can identify a sub-call',()=>{assert.equal(search('genentech'),'c1,c2');assert.equal(search('Truck Loader'),'c3');assert.equal(search('3812'),'c1');});
check('person search returns all their calls including associated crew',()=>{assert.equal(search('gary smith'),'c1,c2');assert.equal(rows[1].callAssignments[1].crew.name,'Colin Jones');});
check('accented names and lead names can be searched',()=>{assert.equal(search('jose martinez'),'c3');assert.equal(search('jamie'),'c3');});
check('multiple terms must belong to same sub-call',()=>{assert.equal(search('Gary PO181278'),'c1,c2');assert.equal(search('Gary Warehouse'),'');});
check('hidden crew names are not indexed',()=>assert.equal(search('Private Person'),''));
check('matched labor dates are limited to results',()=>{search('Warehouse');const result=vm.runInContext(js('('+memos.eventSearchDays+')()'),ctx);assert.equal(result.map(day=>day.id).join(','),'d1');});
check('no match returns no booth results',()=>{search('not present');assert.equal(vm.runInContext(js('('+memos.eventSearchBoothSections+')()'),ctx).length,0);});
check('area actions retain original full area even after narrower person search',()=>{search('Colin');const result=vm.runInContext(js('('+memos.eventSearchBoothSections+')()'),ctx);assert.equal(result.length,1);assert.equal(result[0],sections[0]);assert.equal(result[0].calls.length,2);});
check('clear search restores all calls and dates without mutating data',()=>{assert.equal(search(''),'c1,c2,c3,c4');assert.equal(vm.runInContext(js('('+memos.eventSearchDays+')()'),ctx),days);assert.equal(vm.runInContext(js('('+memos.eventSearchBoothSections+')()'),ctx),sections);assert.equal(rows.length,4);});
console.log(passed+' event sub-call search checks passed.');
if(process.env.BROWSER_TEST_MODULES)(async()=>{
 const {build}=require(path.join(process.env.BROWSER_TEST_MODULES,'esbuild')),{chromium}=require(path.join(process.env.BROWSER_TEST_MODULES,'playwright-core'));
 let searchBar;
 function findBar(node){if(ts.isJsxElement(node)&&node.openingElement.attributes.properties.some(p=>p.name?.getText(ast)==='role'&&p.initializer?.text==='search'))searchBar=node.getText(ast);ts.forEachChild(node,findBar);}findBar(ast);
 assert.ok(searchBar);
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {matchesEventCallSearch} from './lib/event-call-search';
 const rows=${JSON.stringify(rows)},days=${JSON.stringify(days)};
 const visibleLaborDays=days,displayCalls=rows,selectedShow={},appUserById=new Map(),subCallReferenceNumber=c=>c.ref,subCallBoothNumber=c=>c.booth;
 const subCallsByDayId=new Map(days.map(d=>[d.id,rows.filter(r=>r.day.id===d.id).map(r=>r.call)]));
 const boothSections=[{booth:'A',calls:rows.slice(0,2)},{booth:'Warehouse',calls:[rows[2]]},{booth:'Other',calls:[rows[3]]}];
 function App(){const [eventSubCallSearch,setEventSubCallSearch]=React.useState(''),[eventDisplayMode,setEventDisplayMode]=React.useState('messages');const deferredEventSubCallSearch=React.useDeferredValue(eventSubCallSearch),eventSubCallSearchActive=Boolean(eventSubCallSearch.trim());
 const eventSearchCallIds=React.useMemo(${memos.eventSearchCallIds},[deferredEventSubCallSearch]);const eventSearchDays=React.useMemo(${memos.eventSearchDays},[eventSearchCallIds,eventSubCallSearchActive]);
 return <main>${searchBar}<div id='results' data-view={eventDisplayMode}>{rows.filter(r=>!eventSubCallSearchActive||eventSearchCallIds.has(r.call.id)).map(r=><article key={r.call.id} data-call={r.call.id}>{r.call.area}</article>)}</div></main>}
 createRoot(document.getElementById('root')).render(<App/>);`;
 const bundle=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent'});
 const server=require('http').createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents)}else{res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto('http://127.0.0.1:'+server.address().port);const input=page.getByRole('searchbox',{name:'Search event sub-calls'});
 await input.fill('PO-181278');await page.waitForFunction(()=>document.querySelectorAll('[data-call]').length===2);assert.equal(await page.locator('#results').getAttribute('data-view'),'booth');check('browser search switches to sub-call view and finds spaced PO references',()=>{});
 await input.fill('José');await page.waitForFunction(()=>document.querySelectorAll('[data-call]').length===1);assert.equal(await page.locator('[data-call]').getAttribute('data-call'),'c3');check('browser person search filters matching calls',()=>{});
 await input.fill('Private Person');await page.waitForFunction(()=>document.querySelectorAll('[data-call]').length===0);assert.ok((await page.getByRole('status').innerText()).includes('0 of 4'));check('browser no-results state reports zero visible matches',()=>{});
 await page.getByRole('button',{name:'Clear search'}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-call]').length===4);assert.equal(await input.inputValue(),'');check('browser clear restores all sub-calls',()=>{});
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
 console.log(passed+' event search checks including browser interactions passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
