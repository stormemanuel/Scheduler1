const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function load(file){const exports={};vm.runInNewContext(compile(fs.readFileSync(path.join(root,file),'utf8')),{exports,require,Blob,File,Uint8Array,atob,btoa});return exports;}
const generator=load('lib/export-pdf-file.ts'),exportsModule=load('lib/export-documents.ts');
const fixture={layout:'call-sheet',title:'Emanuel Labor Services Labor Call List',meta:[['Client','NMR Events'],['Event','MOBILE TEST'],['Venue','Test Convention Center'],['Location','100 Test St']],sections:[{heading:'Test Booth - Day 1',subheading:'Booth 20 - test crew',columns:['Name','Date / Times','Position','Contact Number','Status','Notes'],rows:Array.from({length:180},(_,i)=>['Worker '+String(i+1).padStart(3,'0'),'2026-11-05 08:00-18:00','General AV','555-0100','Confirmed',i===179?'LAST ROW MUST BE INCLUDED':'Test notes']),rowKinds:Array.from({length:180},()=> 'data')},{heading:'Day 2',columns:['Name','Times','Status'],rows:[['Final Worker','09:00-19:00','Confirmed']]}]};
let passed=0;function check(name,fn){fn();passed++;console.log('PASS '+name);}
(async()=>{
 const pdf=await generator.createExportPdf(fixture,exportsModule.ELS_EXPORT_LOGO_DATA_URI);const bytes=Buffer.from(await pdf.arrayBuffer());
 if(process.env.PDF_TEST_OUTPUT)fs.writeFileSync(process.env.PDF_TEST_OUTPUT,bytes);
 check('export is a genuine PDF file, not HTML',()=>{assert.equal(pdf.type,'application/pdf');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');});
 const parsed=await require('pdf-parse/lib/pdf-parse.js')(bytes);
 check('long crew list paginates and retains first and last workers',()=>{assert.ok(parsed.numpages>1);for(const name of ['Worker 001','Worker 180','Final Worker','LAST ROW MUST BE INCLUDED'])assert.ok(parsed.text.includes(name),name);});
 check('PDF retains show metadata and section headings',()=>{for(const label of ['MOBILE TEST','NMR Events','100 Test St','Test Booth - Day 1','Day 2'])assert.ok(parsed.text.includes(label),label);});
 if(process.env.BROWSER_TEST_MODULES){
  const {build}=require(path.join(process.env.BROWSER_TEST_MODULES,'esbuild'));
  const {chromium}=require(path.join(process.env.BROWSER_TEST_MODULES,'playwright-core'));
  const bundle=await build({stdin:{contents:'import {exportDocumentPdfFile} from "./lib/export-documents";window.exportPdf=exportDocumentPdfFile;',resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser',alias:{'@':root},logLevel:'silent'});
  const server=require('http').createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}else{res.setHeader('Content-Type','text/html');res.end('<button id="export">PDF Crew List</button><script src="/bundle.js"></script><script>document.getElementById("export").onclick=()=>window.exportPdf('+JSON.stringify(fixture)+',"mobile_crew_list");</script>');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
   await context.addInitScript(()=>{Object.defineProperty(Navigator.prototype,'canShare',{configurable:true,value:()=>true});Object.defineProperty(Navigator.prototype,'share',{configurable:true,value:async data=>{window.sharedFile={name:data.files[0].name,type:data.files[0].type,size:data.files[0].size,magic:new TextDecoder().decode((await data.files[0].arrayBuffer()).slice(0,5))};}});});
   const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
   const ready=async()=>{const pending=page.waitForEvent('popup');await page.click('#export');const popup=await pending;await popup.waitForFunction(()=>document.querySelector('#pdf-status')?.textContent.includes('PDF ready'));return popup;};
   const popup=await ready();
   check('mobile preview exposes ready Save PDF, Share PDF and Open PDF controls',()=>{});
   assert.equal(await popup.locator('#pdf-share').isVisible(),true);assert.ok((await popup.locator('#pdf-open').getAttribute('href')).startsWith('blob:'));
   const pending=popup.waitForEvent('download');await popup.click('#pdf-save');const download=await pending;
   const downloaded=fs.readFileSync(await download.path());
   check('Save PDF downloads real PDF bytes and a .pdf filename',()=>{assert.equal(download.suggestedFilename(),'mobile_crew_list.pdf');assert.equal(downloaded.subarray(0,5).toString(),'%PDF-');});
   await popup.click('#pdf-share');await popup.waitForFunction(()=>window.sharedFile);
   const shared=await popup.evaluate(()=>window.sharedFile);
   check('Share PDF passes real PDF file to native share sheet',()=>{assert.equal(shared.name,'mobile_crew_list.pdf');assert.equal(shared.type,'application/pdf');assert.equal(shared.magic,'%PDF-');});
   await popup.evaluate(()=>{Object.defineProperty(navigator,'share',{configurable:true,value:()=>Promise.reject(new DOMException('Canceled','AbortError'))});});await popup.click('#pdf-share');await popup.waitForFunction(()=>document.querySelector('#pdf-status').textContent.includes('Sharing canceled'));
   check('canceling sharing keeps save and open controls available',()=>{});assert.equal(await popup.locator('#pdf-save').isVisible(),true);
   await popup.close();
   await context.addInitScript(()=>{Object.defineProperty(Navigator.prototype,'canShare',{configurable:true,value:()=>false});});await page.reload();
   const fallback=await ready();assert.equal(await fallback.locator('#pdf-share').isVisible(),false);assert.equal(await fallback.locator('#pdf-save').isVisible(),true);assert.equal(await fallback.locator('#pdf-open').isVisible(),true);
   check('unsupported file sharing leaves working Save and Open links',()=>{});
   await fallback.close();await page.evaluate(()=>{window.open=()=>null;});
   const blockedDownload=page.waitForEvent('download');await page.click('#export');const blocked=await blockedDownload;const blockedBytes=fs.readFileSync(await blocked.path());
   check('popup blocking still downloads an actual PDF instead of HTML',()=>{assert.equal(blocked.suggestedFilename(),'mobile_crew_list.pdf');assert.equal(blockedBytes.subarray(0,5).toString(),'%PDF-');});
   await context.close();
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
 }
 console.log(passed+' mobile PDF checks passed. Native iPhone testing still required.');
})().catch(error=>{console.error(error);process.exitCode=1});
