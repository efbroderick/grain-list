const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture,domain,data,hash,allowed,clone,root,applyPublication}=require('./helpers/admin_fixture.cjs');
test('admin browser script parses before deployment',()=>{const source=fs.readFileSync(path.join(root,'admin/apps-script/Client.html'),'utf8');assert.doesNotThrow(()=>new (require('node:vm').Script)(source.replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '')));});

test('draft save hashes only its selected record and reads each source tab once',()=>{
  const f=fixture(),sheet=f.tables.get('Listings'),r=f.state().records[0];
  for(let i=1;i<768;i++){const row=[...sheet.rows[1]];row[f.headers.indexOf('Name')]='Farm '+i;row[f.headers.indexOf('Record ID')]='org-'+i;row[f.headers.indexOf('Public ID')]=domain.publicId('org-'+i,hash);sheet.rows.push(row);}
  f.env.digests=0;f.env.reads=[];
  f.context.saveAdminDraft({recordId:r.recordId,baseRevision:r.revision,data});
  assert.ok(f.env.digests<15,`Expected targeted hashing, got ${f.env.digests}`);
  assert.deepEqual(f.env.reads,['Listings','Admin Drafts']);
  f.env.reads=[];f.state();assert.equal(f.env.reads.filter(n=>n==='Listings').length,1);
});
test('lost save responses can be retried without duplicate new organizations or draft versions',()=>{
  const f=fixture(),input={draftId:'12345678-1234-4123-8123-123456789abc',version:0,recordId:'',baseRevision:'',data:{...data,name:'New farm'}};
  const first=f.context.saveAdminDraft(input),retry=f.context.saveAdminDraft(input);
  assert.equal(retry.recordId,first.recordId);assert.equal(retry.version,1);assert.equal(f.tables.get('Admin Drafts').rows.length,2);
  assert.throws(()=>f.context.saveAdminDraft({...input,data:{...input.data,name:'Conflicting edit'}}),/another tab/);
});

test('confirmation reads bypass stale SpreadsheetApp caches after REST writes',()=>{
  const f=fixture();for(const sheet of f.tables.values())sheet.getDataRange=()=>{throw new Error('Cached native read must not be used');};
  const draft=f.save({grains:['Rye']}),result=f.context.publishAdminDraft({draftId:draft.draftId,version:draft.version});assert.equal(result.status,'Queued');assert.equal(f.env.dispatches.length,1);assert.equal(f.context.activity_()[0].Status,'Queued');assert.equal(f.state().records[0].grains[0],'Rye');
});

test('admin uses Current Listings and preserves its existing public Record IDs',()=>{
  const f=fixture(),s=f.tables.get('Listings');
  s.rows=[['Name','Category','State','City','Function','Grains','Address','Phone','Email','Website','Grain List Profile','Sources','Record ID'],[data.name,data.category,data.state,data.city,data.functions.join('; '),data.grains.join('; '),data.address,data.phone,data.email,data.url,'https://grain-list.vercel.app/organizations/sample-farm/',data.sources.join('\n'),f.publicId]];
  const before=clone(s.rows[1]);f.tables.delete('Admin Drafts');f.tables.delete('Admin Activity');
  assert.equal(f.context.ADMIN_SHEET_ID_,'1zhNRetv5gNYuaQtlZ8hxsW7GBdX7VpMbSN9boXkuYT8');assert.equal(f.state().needsSetup,true);f.context.initializeAdmin();
  assert.deepEqual(s.rows[1].slice(0,13),before);const record=f.state().records[0];assert.equal(record.recordId,f.publicId);assert.equal(record.publicId,f.publicId);assert.equal(record.url,data.url);assert.deepEqual([...record.sources],data.sources);assert.equal(f.state().unlinked.length,0);
  const draft=f.context.saveAdminDraft({recordId:record.recordId,baseRevision:record.revision,data:{...data,grains:['Rye']}});f.context.publishAdminDraft({draftId:draft.draftId,version:draft.version});assert.equal(s.rows.length,2);assert.equal(s.rows[1][12],f.publicId);assert.equal(s.rows[1][5],'Rye');assert.equal(JSON.parse(f.env.dispatches[0].inputs.publication).upserts[0].id,f.publicId);
});
test('new source rows receive a stable link that redirects to their named profile',()=>{
  const f=fixture(),sheet=f.tables.get('Listings');sheet.rows[0].push('Grain List Profile');sheet.rows[1].push('https://grain-list.vercel.app/organizations/sample-farm/');
  const draft=f.context.saveAdminDraft({data:{...data,name:'New Farm'}});f.context.publishAdminDraft({draftId:draft.draftId,version:draft.version});assert.equal(sheet.rows[2].at(-1),'https://grain-list.vercel.app/organizations/'+draft.publicId+'/');assert.equal(sheet.rows[1].at(-1),'https://grain-list.vercel.app/organizations/sample-farm/');
});

test('admin fails closed for a different or unavailable Google identity',()=>{
  for(const activeEmail of ['', 'someone@private.test']){const f=fixture({activeEmail});for(const fn of ['getAdminState','initializeAdmin','saveAdminDraft','publishAdminDraft','getAdminPublicationStatus','lookupAdminAddress'])assert.throws(()=>f.context[fn]({}),/restricted/);assert.equal(f.env.writes.length,0);}
});
test('admin requires the explicitly configured owner and a server lock',()=>{
  const f=fixture();f.properties.delete('ADMIN_EMAIL');assert.throws(()=>f.state(),/ADMIN_EMAIL/);f.properties.set('ADMIN_EMAIL','owner@private.test');f.env.lockBusy=true;assert.throws(()=>f.save(),/Another save/);
});
test('Google-hosted admin explicitly enables the mobile viewport',()=>{
  const output=fixture().context.doGet();assert.equal(output.name,'viewport');assert.equal(output.value,'width=device-width, initial-scale=1');
});
test('draft saves are durable in Google Sheet without changing the master record',()=>{
  const f=fixture(), before=clone(f.tables.get('Listings').rows);
  const d=f.save({grains:['Rye']});assert.equal(d.state,'Draft');assert.equal(f.tables.get('Admin Drafts').rows.length,2);assert.deepEqual(f.tables.get('Listings').rows,before);assert.equal(f.env.dispatches.length,0);
});
test('incomplete additions can be saved as drafts but cannot publish',()=>{
  const f=fixture();const draft=f.context.saveAdminDraft({data:{name:'New farm',functions:[],grains:[],sources:[]}});assert.equal(draft.data.state,'');assert.equal(f.tables.get('Listings').rows.length,2);assert.throws(()=>f.context.publishAdminDraft({draftId:draft.draftId,version:draft.version}),/state/);
});
test('stale source revisions and concurrent draft edits cannot overwrite newer work',()=>{
  const f=fixture(), d=f.save();f.context.saveAdminDraft({...d,data:{...data,grains:['Rye']}});assert.throws(()=>f.context.saveAdminDraft({...d,data}),/another tab/);
  const s=f.state().records[0];f.tables.get('Listings').rows[1][f.headers.indexOf('Name')]='Updated directly in Sheet';assert.throws(()=>f.context.saveAdminDraft({recordId:s.recordId,baseRevision:s.revision,data}),/Sheet changed/);
});
test('publishing saves to master first, preserves private columns, and dispatches public fields only',()=>{
  const f=fixture(),d=f.save({grains:['Rye']});const result=f.context.publishAdminDraft({draftId:d.draftId,version:d.version});
  assert.equal(result.status,'Queued');const row=f.tables.get('Listings').rows[1];assert.equal(row[f.headers.indexOf('Grains')],'Rye');assert.equal(row[f.headers.indexOf('Notes')],'Private note preserved');assert.equal(row[f.headers.indexOf('Confidence')],'0.9');
  const sent=JSON.parse(f.env.dispatches[0].inputs.publication);assert.equal(sent.upserts[0].id,f.publicId);assert.equal('recordId' in sent.upserts[0],false);assert.equal('notes' in sent.upserts[0],false);assert.equal(sent.upserts[0].grains[0],'Rye');assert.equal(f.env.metadata.length,1);
});
test('row metadata follows the record through sorting and never writes a different row',()=>{
  const f=fixture(),table=f.context.readRecords_().table;
  f.context.writeRecord_(table,f.rawId,{Phone:'303-555-1111'});
  const target=table.sheet.rows[1],other=[...target];other[f.headers.indexOf('Record ID')]='org-other';other[f.headers.indexOf('Public ID')]='grain-abcdefabcdefabcd';other[f.headers.indexOf('Phone')]='303-555-2222';table.sheet.rows=[table.sheet.rows[0],other,target];
  f.context.writeRecord_(table,f.rawId,{Phone:'303-555-3333'});assert.equal(other[f.headers.indexOf('Phone')],'303-555-2222');assert.equal(target[f.headers.indexOf('Phone')],'303-555-3333');
});
test('changing a Public ID directly in the Sheet invalidates an open form',()=>{
  const f=fixture(),r=f.state().records[0];f.tables.get('Listings').rows[1][f.headers.indexOf('Public ID')]='grain-abcdefabcdefabcd';assert.throws(()=>f.context.saveAdminDraft({recordId:r.recordId,baseRevision:r.revision,data}),/Sheet changed/);
});
test('no publishing token leaves a draft intact and never changes the master',()=>{
  const f=fixture(),d=f.save({grains:['Rye']}),before=clone(f.tables.get('Listings').rows);f.properties.delete('GITHUB_TOKEN');assert.throws(()=>f.context.publishAdminDraft({draftId:d.draftId,version:d.version}),/not configured/);assert.deepEqual(f.tables.get('Listings').rows,before);
});
test('failed dispatch reports saved but not published and retains a retryable draft',()=>{
  const f=fixture(),d=f.save({grains:['Rye']});f.env.failDispatch=true;const result=f.context.publishAdminDraft({draftId:d.draftId,version:d.version});assert.equal(result.status,'Saved; not published');assert.equal(f.properties.has('ACTIVE_PUBLICATION'),false);assert.equal(f.tables.get('Listings').rows[1][f.headers.indexOf('Grains')],'Rye');
  f.env.failDispatch=false;const retry=f.context.publishAdminDraft({draftId:d.draftId,version:result.draft.version});assert.equal(retry.status,'Queued');assert.equal(f.tables.get('Listings').rows.length,2);
});
test('a second publication is blocked until the active one completes',()=>{
  const f=fixture(),d=f.save();const r=f.context.publishAdminDraft({draftId:d.draftId,version:d.version});assert.throws(()=>f.context.publishAdminDraft({draftId:d.draftId,version:r.draft.version}),/in progress/);
});
test('a dispatched job remains queued and locked while GitHub indexes the run',()=>{
  const f=fixture(),d=f.save(),r=f.context.publishAdminDraft({draftId:d.draftId,version:d.version});assert.equal(f.context.getAdminPublicationStatus(r.requestId).status,'Queued');assert.ok(f.properties.has('ACTIVE_PUBLICATION'));assert.throws(()=>f.context.publishAdminDraft({draftId:d.draftId,version:r.draft.version}),/in progress/);
});
test('a live listing changed after review cannot be silently overwritten',()=>{
  const f=fixture(),d=f.save({grains:['Rye']});f.env.live[0].phone='303-555-7777';assert.throws(()=>f.context.publishAdminDraft({draftId:d.draftId,version:d.version}),/live listing changed/);assert.equal(f.env.dispatches.length,0);
});
test('live status requires both a successful workflow and matching deployed data',()=>{
  const f=fixture(),d=f.save({grains:['Rye']}),r=f.context.publishAdminDraft({draftId:d.draftId,version:d.version});
  f.env.runs=[{display_title:'Admin publication '+r.requestId,status:'completed',conclusion:'success',html_url:'https://github.com/efbroderick/grain-list/actions/runs/123'}];
  assert.equal(f.context.getAdminPublicationStatus(r.requestId).status,'Deploying');f.env.live=JSON.parse(f.env.dispatches[0].inputs.publication).upserts;assert.equal(f.context.getAdminPublicationStatus(r.requestId).status,'Published');assert.equal(f.properties.has('ACTIVE_PUBLICATION'),false);assert.equal(f.context.drafts_()[0].state,'Published');
});
test('failed validation never claims published even if live fields already match',()=>{
  const f=fixture(),d=f.save(),r=f.context.publishAdminDraft({draftId:d.draftId,version:d.version});f.env.runs=[{display_title:'Admin publication '+r.requestId,status:'completed',conclusion:'failure'}];assert.equal(f.context.getAdminPublicationStatus(r.requestId).status,'Publication failed');
});
test('clearing published values and closing records require explicit confirmation',()=>{
  const f=fixture(),d=f.save({phone:''});assert.throws(()=>f.context.publishAdminDraft({draftId:d.draftId,version:d.version}),/Confirm removed/);
  const g=fixture(),closed=g.save({operationalStatus:'Closed'});assert.throws(()=>g.context.publishAdminDraft({draftId:closed.draftId,version:closed.version}),/Confirm removed/);const result=g.context.publishAdminDraft({draftId:closed.draftId,version:closed.version,confirmRemoval:true});assert.equal(result.status,'Queued');assert.deepEqual(JSON.parse(g.env.dispatches[0].inputs.publication).removals,[g.publicId]);
});
test('map confirmation, placeholders, forbidden grains and unsupported functions are rejected',()=>{
  for(const change of [{functions:['Not a function']},{grains:['chickpeas']},{email:'test@sample.test'},{url:'javascript:alert(1)'},{sources:['not a URL']},{location:{lat:NaN,lng:0,precision:'address'}}])assert.throws(()=>domain.normalize({...data,...change},allowed));
  const f=fixture(),d=f.save({locationChecked:false});assert.throws(()=>f.context.publishAdminDraft({draftId:d.draftId,version:d.version}),/Confirm the map/);
});
test('Sheet writes treat user input as literal text, not formulas',()=>{
  const f=fixture(),d=f.save({name:'=IMPORTXML("https://evil.test")'});f.context.publishAdminDraft({draftId:d.draftId,version:d.version});assert.equal(f.tables.get('Listings').rows[1][f.headers.indexOf('Name')],'=IMPORTXML("https://evil.test")');
});
test('initialization preserves existing IDs and details while binding missing IDs to current site identities',()=>{
  const f=fixture(),sheet=f.tables.get('Listings');sheet.rows[0]=sheet.rows[0].slice(0,15);sheet.rows[1]=sheet.rows[1].slice(0,15);sheet.rows[1][13]='';const before=sheet.rows[1].slice(0,13);f.tables.delete('Admin Drafts');f.tables.delete('Admin Activity');
  f.context.initializeAdmin();assert.deepEqual(sheet.rows[1].slice(0,13),before);assert.equal(sheet.rows[1][sheet.rows[0].indexOf('Public ID')],f.publicId);assert.ok(sheet.rows[1][13]);assert.ok(f.state().records[0].locationChecked);
});
test('a unique exact website preserves identity even when the source name contains a typo',()=>{
  const f=fixture(),sheet=f.tables.get('Listings');sheet.rows[0]=sheet.rows[0].slice(0,15);sheet.rows[1]=sheet.rows[1].slice(0,15);sheet.rows[1][13]='';sheet.rows[1][2]='Sampl Farm';f.tables.delete('Admin Drafts');f.tables.delete('Admin Activity');f.context.initializeAdmin();assert.equal(f.state().records[0].publicId,f.publicId);
});
test('publication changes only the reviewed record, not unrelated source rows',()=>{
  const first=clone(domain.toPublic(data,'grain-1111111111111111','Partial')), second={...clone(first),id:'grain-2222222222222222',name:'Other farm',state:'MT'};
  const requestId=crypto.randomUUID(), input={requestId,upserts:[{...first,grains:['Rye']}],removals:[]};const next=applyPublication({organizations:[first,second]},input,requestId);assert.deepEqual(next.organizations.find(o=>o.id===second.id),second);assert.deepEqual(next.organizations.find(o=>o.id===first.id).grains,['Rye']);
  assert.throws(()=>applyPublication({organizations:[first]}, {...input,upserts:[{...first,notes:'private'}]},requestId),/Private/);assert.throws(()=>applyPublication({organizations:[first]},input,crypto.randomUUID()),/mismatch/);
});
test('private admin assets are never copied to the public static site',()=>{
  const build=fs.readFileSync(path.join(root,'tools/build_site.cjs'),'utf8');assert.equal(build.includes('fs.cpSync(path.join(root, "admin")'),false);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'admin/apps-script/appsscript.json')));assert.equal(manifest.webapp.access,'MYSELF');assert.equal(manifest.webapp.executeAs,'USER_DEPLOYING');
});
test('all callable Apps Script functions enforce the owner check',()=>{
  const source=fs.readFileSync(path.join(root,'admin/apps-script/Code.gs'),'utf8'), functions=[...source.matchAll(/^function ([A-Za-z0-9_]+)\([^)]*\)\s*\{/gm)];for(let i=0;i<functions.length;i++){const fn=functions[i];if(fn[1].endsWith('_'))continue;assert.match(source.slice(fn.index,functions[i+1]?.index),/owner_\(\)/,fn[1]);}
});
test('generated Function schema stays synchronized with the publication vocabulary',()=>assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'admin/apps-script/Schema.html'))).allowed_functions,allowed));
