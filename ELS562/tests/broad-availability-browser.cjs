const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 if(!process.env.BROWSER_TEST_MODULES)throw new Error('Set BROWSER_TEST_MODULES to the directory containing playwright-core and esbuild.');
 const {build}=require(path.join(process.env.BROWSER_TEST_MODULES,'esbuild')),{chromium}=require(path.join(process.env.BROWSER_TEST_MODULES,'playwright-core'));
 const source=fs.readFileSync(path.join(root,'app/events/events-client.tsx'),'utf8'),ast=ts.createSourceFile('client.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let dateCard,preview;
 function walk(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='availabilityTemplatePreviewText')preview=node.getText(ast);if(ts.isJsxElement(node)&&node.children.some(child=>ts.isJsxElement(child)&&child.openingElement.tagName.getText(ast)==='strong'&&child.children.some(text=>ts.isJsxText(text)&&text.text==='General date-range availability')))dateCard=node.getText(ast);ts.forEachChild(node,walk);}walk(ast);assert.ok(dateCard&&preview);
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {availabilityDateRange,broadAvailabilityMessage} from './lib/broad-availability';
 const crewById=new Map([['crew',{name:'Reginald'}]]),firstName=name=>name.split(' ')[0],safeText=v=>String(v||''),currentUserName='Storm Leigh',currentUserEmail='';
 function App(){const availabilityRequestMode='date_range';const [availabilityRangeStart,setAvailabilityRangeStart]=React.useState('2026-12-08'),[availabilityRangeEnd,setAvailabilityRangeEnd]=React.useState('2026-12-16'),[selectedAvailabilityCrewIds,setSelectedAvailabilityCrewIds]=React.useState(['crew']),[rate,setRate]=React.useState('$35/hr');
 let availabilityRangeError='';try{availabilityDateRange(availabilityRangeStart,availabilityRangeEnd)}catch(error){availabilityRangeError=error.message}
 const availabilityCandidateRole='',availabilityRequestDetails={show_reference:'ASH26 | Test Event',location:'Convention Center — 100 Test St',rate};
 ${preview}
 return <main>${dateCard}<label>Outreach rate<input value={rate} onChange={event=>setRate(event.target.value)}/></label><pre id='preview'>{availabilityTemplatePreviewText()}</pre></main>}
 createRoot(document.getElementById('root')).render(<App/>);`;
 const bundle=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',logLevel:'silent'});
 const server=require('http').createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents)}else{res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>document.querySelector('#preview')?.textContent.includes('December 16, 2026'));
 let message=await page.locator('#preview').innerText();for(const expected of ['any of these days','ASH26 | Test Event','100 Test St','$35/hr','December 8, 2026 through December 16, 2026'])assert.ok(message.includes(expected),expected);assert.ok(!message.includes('Position:'));console.log('PASS browser preview includes event, location, rate and entire date range without sub-calls');
 await page.getByLabel('Through',{exact:true}).fill('2026-12-07');await page.waitForFunction(()=>document.querySelector('#preview').textContent.includes('Choose valid'));console.log('PASS browser prevents reversed date range in preview');
 await page.getByLabel('Through',{exact:true}).fill('2026-12-20');await page.getByLabel('Outreach rate').fill('$40/hr');await page.waitForFunction(()=>document.querySelector('#preview').textContent.includes('$40/hr'));message=await page.locator('#preview').innerText();assert.ok(message.includes('December 20, 2026'));assert.ok(message.includes('Please reply with the dates you are available to work.'));console.log('PASS browser date and rate changes update the general inquiry');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
