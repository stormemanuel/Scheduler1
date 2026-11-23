// Browser fixture renders the real Booking View and real hold handlers with a mock API.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict'),ts=require('typescript');
const modules=process.env.BROWSER_TEST_MODULES;if(!modules)throw Error('Set BROWSER_TEST_MODULES to browser test dependencies.');
const esbuild=require(path.join(modules,'esbuild')),{chromium}=require(path.join(modules,'playwright-core'));
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app/events/events-client.tsx'),'utf8'),ast=ts.createSourceFile('client.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['renderBookingPanel','holdsForCall','saveBookingHold','confirmBookingHold'];let parts=[],grouping;
function walk(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))parts.push(n.getText(ast));if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='bookingBoothSections')grouping=n.initializer.arguments[0].getText(ast);ts.forEachChild(n,walk)}walk(ast);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'els-hold-ui-')),entry=path.join(temp,'entry.tsx');
fs.writeFileSync(entry,`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{activeBookingHolds,notesWithBookingHolds,readBookingHolds}from ${JSON.stringify(path.join(root,'lib/booking-holds'))};
const day={id:'day',labor_date:'2026-12-10'},original={id:'call',area:'MERCK',role_name:'LED Stagehand',crew_needed:1,notes:''};let backend={...original};let requests=[];
const crewById=new Map([['brian',{id:'brian',name:'Brian Crew'}],['jorge',{id:'jorge',name:'Jorge Crew'}]]);
const assignmentCountsAsFilled=a=>!['declined','canceled'].includes(a.status);const sanitizeAssignment=a=>a;
const mergeById=(old,added)=>[...old.filter(x=>!added.some(y=>x.id===y.id)),...added];
const formatFullDate=v=>v,formatTimeRange=()=> '8:00 AM–6:00 PM',dayTypeLabel=()=> 'Full day',effectiveCallDayType=()=> 'full_day',walkawayLabel=()=>'',subCallBoothNumber=()=>'',subCallReferenceNumber=()=>'',areaLeadLine=()=>'',messageRateLabelForCall=()=> 'Rate: $35/hr';
const activeRateCity='New Orleans',liveMasterRates=[],canManageEventAccess=true,currentUserId='storm',localInputDate=()=> '2026-11-20';
const bookingBoothKey=v=>v,boothLabel=v=>v,compareBoothViewCallItems=()=>0,displayAreaForCalls=v=>v;
function App(){
const [subCalls,setSubCalls]=useState([{...backend}]),[assignments,setAssignments]=useState([]),[bookingHoldRespondBy,setBookingHoldRespondBy]=useState(''),[bookingHoldBusy,setBookingHoldBusy]=useState(false),[crewPickerCallId,setCrewPickerCallId]=useState(null),[bookingFilter,setBookingFilter]=useState('needs'),[message,setMsg]=useState(null),[person,setPerson]=useState('brian');
const crewAssignmentTargetCallIds=['call'],subCallById=new Map(subCalls.map(call=>[call.id,call])),laborDayById=new Map([['day',day]]);
const selectedShow={id:'show'},selectedShowHasPartialCoordinatorAccess=false,saving=false,expandedBookingCallIds=[],expandedBookingBoothKeys=[],bookingFullyBookedExpanded=false;
const renderCallNextPanel=()=>null;
const preserveScrollAnchor=()=>{},openCrewPickerForBookingCall=id=>setCrewPickerCallId(id),openBookingAvailability=()=>{},defaultOpenCrewAssignmentCallIds=()=>[],toggleBookingBookedCrew=()=>{},setEventDisplayMode=()=>{},scrollToNextOpenShift=()=>{},refreshSelectedEventData=()=>{},setBookingFullyBookedExpanded=()=>{},setExpandedBookingBoothKeys=()=>{};
const request=async(url,method,body)=>{requests.push({url,method,body});if(body.action==='booking_hold_add'){backend.notes=notesWithBookingHolds(backend.notes,[{id:'hold',crew_id:body.crew_id,respond_by:body.respond_by,created_by:'storm',created_at:'2026-11-20T12:00:00Z'}]);return {call:{...backend}};}if(body.action==='booking_hold_release'){backend.notes=notesWithBookingHolds(backend.notes,[]);return {call:{...backend}};}return {row:{id:'a',sub_call_id:'call',crew_id:body.crew_id,status:'confirmed'}}};
${parts.filter(p=>!p.startsWith('function renderBookingPanel')).join('\n')}
const displayCalls=subCalls.map(call=>({call,day,callAssignments:assignments.filter(a=>a.sub_call_id===call.id).map(assignment=>({assignment,crew:crewById.get(assignment.crew_id)}))}));
const bookingBoothSections=(${grouping})();const bookingNeedsSections=bookingBoothSections.filter(s=>s.openCount>0),bookingFullyBookedSections=bookingBoothSections.filter(s=>s.fullyBooked);
const bookingSummary={openCount:bookingBoothSections.reduce((n,s)=>n+s.openCount,0),holdCount:bookingBoothSections.reduce((n,s)=>n+s.calls.reduce((a,c)=>a+c.holdCount,0),0),requestedCount:1,bookedCount:assignments.length,boothsNeedCrew:bookingNeedsSections.length,fullyBookedBooths:bookingFullyBookedSections.length};
function renderCrewPicker(call){return <div><label>Potential crew member<select aria-label="Potential crew member" value={person} onChange={e=>setPerson(e.target.value)}><option value="brian">Brian Crew</option><option value="jorge">Jorge Crew</option></select></label><label>Respond by<input aria-label="Respond by" type="date" value={bookingHoldRespondBy} onChange={e=>setBookingHoldRespondBy(e.target.value)}/></label><button onClick={()=>saveBookingHold(call,person)}>Hold this shift</button></div>}
${parts.find(p=>p.startsWith('function renderBookingPanel'))}
return <>{renderBookingPanel()}<output>{message?.text||''}</output></>;
}createRoot(document.getElementById('root')).render(<App/>);
`);
(async()=>{const result=await esbuild.build({entryPoints:[entry],bundle:true,write:false,jsx:'automatic',nodePaths:[path.join(root,'node_modules')],define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
const page=await browser.newPage({viewport});page.on('pageerror',e=>console.error(e));await page.setContent('<html><body><div id="root"></div></body></html>');await page.addScriptTag({content:result.outputFiles[0].text});
await page.getByRole('button',{name:'Add Crew',exact:true}).click();await page.getByLabel('Potential crew member').selectOption('jorge');await page.getByLabel('Respond by',{exact:true}).fill('2026-12-01');await page.getByRole('button',{name:'Hold this shift',exact:true}).click();
await page.getByText('ON HOLD · Jorge Crew',{exact:true}).waitFor();assert.ok(await page.getByText('Respond by 2026-12-01',{exact:false}).isVisible());assert.ok(await page.getByRole('heading',{name:'Needs Booking',exact:true}).isVisible());assert.ok(!(await page.getByText('✓ All staffing is complete',{exact:true}).count()));
const yellow=await page.getByText('ON HOLD · Jorge Crew',{exact:true}).evaluate(el=>getComputedStyle(el.closest('.card')).backgroundColor);assert.equal(yellow,'rgb(254, 243, 199)');
console.log('PASS '+viewport.width+'px selected potential tech and response date appear in yellow and remain under Needs Booking');
await page.getByRole('button',{name:'Release hold',exact:true}).click();await page.getByText('ON HOLD · Jorge Crew',{exact:true}).waitFor({state:'detached'});assert.ok(await page.getByRole('button',{name:'Add Crew',exact:true}).isVisible());
console.log('PASS '+viewport.width+'px releasing a hold reopens the position');
await page.getByLabel('Respond by',{exact:true}).fill('2026-11-19');await page.getByRole('button',{name:'Hold this shift',exact:true}).click();await page.getByText('ON HOLD · Jorge Crew',{exact:true}).waitFor();assert.ok(await page.getByText('RESPONSE OVERDUE',{exact:false}).isVisible());assert.ok(await page.getByRole('heading',{name:'Needs Booking',exact:true}).isVisible());console.log('PASS '+viewport.width+'px overdue holds stay visible until confirmed or released');await page.getByRole('button',{name:'Confirm booking',exact:true}).click();await page.getByText('✓ All staffing is complete',{exact:true}).waitFor();assert.ok(!(await page.getByText('ON HOLD · Jorge Crew',{exact:true}).count()));
console.log('PASS '+viewport.width+'px confirming converts the hold into an actual completed booking');await page.close();
}}finally{await browser.close();fs.rmSync(temp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
