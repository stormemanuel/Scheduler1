// Run with BROWSER_TEST_MODULES pointing to a directory containing playwright-core and esbuild.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const modules=process.env.BROWSER_TEST_MODULES;
if(!modules)throw new Error('Set BROWSER_TEST_MODULES to the installed browser test dependencies.');
const {chromium}=require(path.join(modules,'playwright-core'));
const esbuild=require(path.join(modules,'esbuild'));
const ts=require('typescript');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'els-mobile-scroll-'));
const entry=path.join(temp,'entry.tsx');
const onboarding=fs.readFileSync(path.join(root,'app/onboarding-center/page.tsx'),'utf8');
const ast=ts.createSourceFile('page.tsx',onboarding,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let openPhoto;function walk(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='openSecureDocument')openPhoto=node.getText(ast);ts.forEachChild(node,walk)}walk(ast);assert.ok(openPhoto);

fs.writeFileSync(entry,`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PhotoPreview} from ${JSON.stringify(path.join(root,'lib/ui/photo-preview'))};
import {useScrollAnchor} from ${JSON.stringify(path.join(root,'lib/ui/use-scroll-anchor'))};
const text=(v:unknown)=>String(v??'').trim();
const photoUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='400'%3E%3Crect width='320' height='400' fill='navy'/%3E%3C/svg%3E";
window.fetch=async()=>({ok:true,json:async()=>({ok:true,signed_url:photoUrl,viewer_kind:'image'})}) as any;
function openDocumentInApp(){throw new Error('Photo must not navigate away from onboarding');}
function App(){
 const [photo,setPhotoPreview]=useState<{url:string,title:string}|null>(null),[area,setArea]=useState('a');const anchor=useScrollAnchor();
 const setBusyId=()=>{},setMessage=()=>{};
 ${openPhoto}

 return <><div style={{height:900}}>Onboarding list</div><input aria-label="Review notes" defaultValue="Keep these review notes"/><button onClick={()=>void openSecureDocument({id:'review',crew_id:'crew',crew:{name:'Brian'}} as any,'profile_photo','private/photo.jpg')}>Open profile photo</button>
 {photo?<PhotoPreview url={photo.url} title={photo.title} onClose={()=>setPhotoPreview(null)}/>:null}
 <div style={{height:700}}/>
 {['a','b','c'].map(id=><section key={id}><button data-area={id} onClick={event=>{anchor(event.currentTarget);setArea(area===id?'':id)}}>Add Crew {id}</button>{area===id?<div data-picker={id} style={{height:1500}}>Crew picker {id}</div>:null}</section>)}
 <button onClick={event=>anchor(event.currentTarget)}>Select current city</button><div style={{height:2000}}>Following crew</div></>;
}createRoot(document.getElementById('root')).render(<App/>);`);
(async()=>{
 const result=await esbuild.build({entryPoints:[entry],bundle:true,write:false,jsx:'automatic',nodePaths:[path.join(root,'node_modules')],define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
 for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
 const page=await browser.newPage({viewport});await page.setContent('<html><body><div id="root"></div></body></html>');await page.addScriptTag({content:result.outputFiles[0].text});
 const button=page.getByRole('button',{name:'Open profile photo'});await button.evaluate(el=>el.scrollIntoView({block:'center'}));
 await page.getByRole('textbox').fill('Unsaved review note');const before=await page.evaluate(()=>scrollY);const url=page.url();await button.click();
 await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Close photo'}).click();
 assert.equal(page.url(),url);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<2);assert.equal(await page.getByRole('textbox').inputValue(),'Unsaved review note');
 console.log('PASS '+viewport.width+'px photo closes at original scroll position with review state intact');
 await button.click();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<2);
 console.log('PASS '+viewport.width+'px Escape closes photo and restores position');
 for(const id of ['b','c','a']){
 const target=page.locator('[data-area='+id+']');await target.evaluate(el=>el.scrollIntoView({block:'center'}));
 const top=(await target.boundingBox()).y;await target.click();await page.locator('[data-picker='+id+']').waitFor();
 const after=(await target.boundingBox()).y;assert.ok(Math.abs(after-top)<3, id+': '+top+' -> '+after);
 }
 console.log('PASS '+viewport.width+'px switching between three crew areas retains tapped control position');
 await page.getByRole('button',{name:'Select current city'}).click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.evaluate(()=>document.documentElement.style.overflowAnchor),'');
 console.log('PASS '+viewport.width+'px selecting the current city leaves normal scrolling enabled');await page.close();
 }
 }finally{await browser.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
