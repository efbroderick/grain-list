const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,domain,data,hash,allowed,clone,applyPublication}=require('./helpers/admin_fixture.cjs');
const branch=(id='loc-1111111111111111',name='Denver')=>({id,name,type:'Farm',address:data.address,city:data.city,state:data.state,phone:data.phone,email:data.email,url:'',functions:[],grains:[],sources:data.sources,operationalStatus:'Active',location:data.location,locationChecked:true});
const withBranches=()=>({...data,locations:[branch(),{...branch('loc-2222222222222222','Boulder'),address:'20 Main Street, Boulder, CO 80301',city:'Boulder',location:{lat:40.01,lng:-105.27,precision:'address'}}]});

test('locations normalize alphabetically with separate functions and no inherited grains',()=>{
  const o=domain.normalize(withBranches(),allowed);
  assert.deepEqual([...o.locations.map(l=>l.name)],['Boulder','Denver']);
  assert.deepEqual([...o.locations[0].functions],[]);assert.deepEqual([...o.locations[0].grains],[]);
  for(const changes of [{id:'bad'},{id:'loc-1111111111111111',name:'duplicate'},{state:'ZZ'},{locationChecked:false},{sources:[]}]){
    const input=withBranches();input.locations[1]={...input.locations[1],...changes};assert.throws(()=>domain.normalize(input,allowed));
  }
});
test('linked location writes update both tabs, retain stable IDs and round-trip revisions',()=>{
  const f=fixture(),r=f.state().records[0],d=f.context.saveAdminDraft({recordId:r.recordId,baseRevision:r.revision,data:withBranches()});
  assert.equal(f.tables.has('Locations'),false);
  const result=f.context.publishAdminDraft({draftId:d.draftId,version:d.version});
  assert.equal(result.status,'Queued');assert.equal(f.tables.get('Locations').rows.length,3);
  const saved=f.state().records[0];assert.equal(saved.locations.length,2);assert.equal(domain.revision(saved,hash),domain.revision(d.data,hash));
  const sent=JSON.parse(f.env.dispatches[0].inputs.publication).upserts[0];assert.equal(sent.locations.length,2);assert.ok(sent.locations.every(l=>!('locationChecked' in l)));
  const current={organizations:f.env.live};const payload=JSON.parse(f.env.dispatches[0].inputs.publication);
  const next=applyPublication(current,payload,payload.requestId);assert.equal(next.organizations[0].locations.length,2);
});
test('a Locations-only Sheet edit invalidates a stale organization form',()=>{
  const f=fixture(),r=f.state().records[0],d=f.context.saveAdminDraft({recordId:r.recordId,baseRevision:r.revision,data:withBranches()});f.context.publishAdminDraft({draftId:d.draftId,version:d.version});
  const before=f.state().records[0],t=f.tables.get('Locations');t.rows[1][t.rows[0].indexOf('Phone')]='303-555-9999';
  assert.throws(()=>f.context.saveAdminDraft({recordId:before.recordId,baseRevision:before.revision,data:before}),/Sheet changed/);
});
test('old admin clients cannot erase branches; closed locations require confirmation and remain in Sheet',()=>{
  const f=fixture(),r=f.state().records[0],d=f.context.saveAdminDraft({recordId:r.recordId,baseRevision:r.revision,data:withBranches()});f.context.publishAdminDraft({draftId:d.draftId,version:d.version});
  f.properties.delete('ACTIVE_PUBLICATION');f.env.live=JSON.parse(f.env.dispatches[0].inputs.publication).upserts;
  const row=f.state().records[0];assert.throws(()=>f.context.saveAdminDraft({recordId:row.recordId,baseRevision:row.revision,data}),/linked locations/);
  const closed=clone(row);closed.locations[0].operationalStatus='Closed';const draft=f.context.saveAdminDraft({recordId:row.recordId,baseRevision:row.revision,data:closed});
  assert.throws(()=>f.context.publishAdminDraft({draftId:draft.draftId,version:draft.version}),/Confirm removed/);
  f.context.publishAdminDraft({draftId:draft.draftId,version:draft.version,confirmRemoval:true});assert.equal(f.tables.get('Locations').rows.length,3);assert.equal(f.state().records[0].locations.filter(l=>l.operationalStatus==='Closed').length,1);
});
test('location metadata follows sorting without changing unrelated branch rows',()=>{
  const f=fixture(),r=f.state().records[0],d=f.context.saveAdminDraft({recordId:r.recordId,baseRevision:r.revision,data:withBranches()});f.context.publishAdminDraft({draftId:d.draftId,version:d.version});f.properties.delete('ACTIVE_PUBLICATION');f.env.live=JSON.parse(f.env.dispatches[0].inputs.publication).upserts;
  const t=f.tables.get('Locations');t.rows=[t.rows[0],t.rows[2],t.rows[1]];
  const row=f.state().records[0],edit=clone(row);edit.locations.find(l=>l.name==='Boulder').phone='303-555-9999';const draft=f.context.saveAdminDraft({recordId:row.recordId,baseRevision:row.revision,data:edit});f.context.publishAdminDraft({draftId:draft.draftId,version:draft.version});
  assert.equal(f.state().records[0].locations.find(l=>l.name==='Denver').phone,data.phone);assert.equal(f.state().records[0].locations.find(l=>l.name==='Boulder').phone,'303-555-9999');
});
test('new organization and its locations commit without duplicate parents on retry',()=>{
  const f=fixture(),d=f.context.saveAdminDraft({data:{...withBranches(),name:'New Farm'}});f.env.failDispatch=true;const result=f.context.publishAdminDraft({draftId:d.draftId,version:d.version});assert.equal(result.status,'Saved; not published');
  f.env.failDispatch=false;f.context.publishAdminDraft({draftId:d.draftId,version:result.draft.version});assert.equal(f.tables.get('Listings').rows.length,3);assert.equal(f.tables.get('Locations').rows.length,3);
});
test('private branch fields never enter public publication payloads',()=>{
  const f=fixture(),o=domain.toPublic(domain.normalize(withBranches(),allowed),f.publicId,'Partial'),id='12345678-1234-4123-8123-123456789abc';o.locations[0].notes='private';assert.throws(()=>applyPublication({organizations:f.env.live},{requestId:id,upserts:[o],removals:[]},id),/Private/);
});
test('research validates ownership and returns evidence without writes or API dispatch',()=>{
  const f=fixture({activeEmail:'other@private.test'});assert.throws(()=>f.context.researchAdminOrganization({}),/restricted/);
  const g=fixture(),research=g.context.GrainAdminResearch;
  for(const url of ['http://sample.com','https://127.0.0.1/','https://localhost/','https://sample.com:443/','https://user:pass@sample.com/','https://a.internal/'])assert.throws(()=>research.host(url));
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Bakery',name:'Sample Farm',address:{streetAddress:'10 Main Street',addressLocality:'Denver',addressRegion:'CO',postalCode:'80202'}})+'</script><p>Our bread is made with Hard Red Winter Wheat. Order our sourdough loaves at the bakery counter. hello@sample.com</p>';
  const results=clone(research.findings(html,'https://sample.com/','Sample Farm'));
  assert.ok(results.some(f=>f.field==='locations'&&f.value.address.includes('80202')));assert.ok(results.some(f=>f.field==='grains'&&f.value==='Hard Red Winter Wheat'));assert.ok(!results.some(f=>f.field==='grains'&&f.value==='Wheat'));assert.ok(results.some(f=>f.field==='functions'&&f.value==='Retail Baked Goods'));assert.ok(results.every(f=>f.source&&f.evidence));
  const stockist=html.replace('"name":"Sample Farm"','"name":"Unrelated Shop"');assert.ok(!research.findings(stockist,'https://sample.com/','Sample Farm').some(f=>f.field==='locations'));
  assert.equal(g.env.dispatches.length,0);assert.equal(g.env.writes.length,0);
});
test('direct-site research endpoint uses bounded fixtures and never calls publishing',()=>{
  const f=fixture();f.env.researchPages['https://sample.com/']='<p>We grow Rye. Order our sourdough loaves at the bakery counter.</p>';
  const result=f.context.researchAdminOrganization({name:data.name,url:'https://sample.com/',pages:[]});
  assert.equal(result.attempts.length,1);assert.ok(result.findings.some(f=>f.value==='Rye'));assert.ok(result.findings.some(f=>f.value==='Grain Grower'));assert.equal(f.env.dispatches.length,0);assert.equal(f.env.writes.length,0);
  assert.throws(()=>f.context.researchAdminOrganization({name:data.name,url:'https://sample.com/',pages:['https://other.com/']}),/official website/);
});
test('official maps-address links suggest owned branches but exclude partner stockists',()=>{
  const f=fixture(),r=f.context.GrainAdminResearch,html='<h1>Locations</h1><h2>Come Visit Us</h2><a href="https://www.google.com/maps/place/X/data=!3d33.63!4d-117.91">234 E 17th St, Costa Mesa, CA 92627</a><a href="https://www.google.com/maps/place/Y/data=!3d33.54!4d-117.78">384 Forest Ave #4 Laguna Beach, CA 92651</a><h2>find Partner LOCATIONS</h2><a href="https://www.google.com/maps/place/Z">500 Main Street, Other City, CA 92627</a>';
  const found=clone(r.findings(html,'https://sample.com/visit','Sample Farm')).filter(f=>f.field==='locations');assert.equal(found.length,2);assert.equal(found[0].value.city,'Costa Mesa');assert.equal(found[1].value.city,'Laguna Beach');assert.equal(found[0].value.location.precision,'organization');assert.ok(found.every(f=>f.source&&f.evidence));
});
test('already closed branches do not repeatedly require removal confirmation',()=>{
  const before=withBranches();before.locations[0].operationalStatus='Closed';const after=clone(before);after.phone='303-555-9999';assert.ok(!domain.cleared(before,after).includes('locations'));
  after.operationalStatus='Closed';after.locations.forEach(l=>{l.location=null;l.locationChecked=false;});assert.doesNotThrow(()=>domain.normalize(after,allowed));
});
