const test=require('node:test');
const assert=require('node:assert/strict');
const {applyApprovedTaxonomy}=require('../tools/apply_approved_taxonomy.cjs');
function fixture(){
  const id='grain-abcdefabcdefabcd',record={id,name:'Reviewed Mill',category:'Baker, Miller',grains:['Oat','Farro'],phone:'555-123-4567',location:{lat:40,lng:-100}};
  const current={generated:'2026-10-28',summary:{total:2},organizations:[record,{id:'grain-1111111111111111',name:'Unrelated New Farm',category:'Farm',grains:['Rye']}]};
  const plan={approvedGroups:['A','B','C','D'],changes:[{recordId:'org-1',publicId:id,name:record.name,field:'category',before:record.category,proposed:'Baker, Mill',approvalGroups:['A']},{recordId:'org-1',publicId:id,name:record.name,field:'grains',before:'Oat; Farro',proposed:'Oats; Farro',approvalGroups:['B']}]};
  const source={records:[{recordId:'org-1',publicId:id,category:'Baker, Mill',grains:'Oats; Farro'}]};
  return {current,plan,source};
}
test('approved taxonomy release changes only reviewed fields and retains unrelated new organizations',()=>{
  const f=fixture(),before=JSON.stringify(f.current),r=applyApprovedTaxonomy(f.current,f.plan,f.source,'2026-10-29');
  assert.equal(r.changes.length,2);assert.equal(r.payload.organizations[0].category,'Baker, Mill');assert.deepEqual(r.payload.organizations[0].grains,['Oats','Farro']);
  assert.equal(r.payload.organizations[0].phone,f.current.organizations[0].phone);assert.deepEqual(r.payload.organizations[1],f.current.organizations[1]);assert.equal(JSON.stringify(f.current),before);
  assert.equal(applyApprovedTaxonomy(r.payload,f.plan,f.source,'2026-10-29').changes.length,0);
});
test('release refuses stale live values, source mismatches, missing IDs, or unapproved field changes',()=>{
  for(const mutate of [f=>f.current.organizations[0].grains=['Barley'],f=>f.source.records[0].grains='Wheat',f=>f.source.records[0].publicId='grain-other',f=>f.plan.changes[0].field='phone',f=>f.plan.approvedGroups=['A']]){const f=fixture();mutate(f);assert.throws(()=>applyApprovedTaxonomy(f.current,f.plan,f.source,'2026-10-29'));}
});
test('release refuses changes not explained by the approved alias configuration',()=>{
  const f=fixture();f.plan.changes[1].proposed='Oats; Emmer Wheat';f.source.records[0].grains='Oats; Emmer Wheat';assert.throws(()=>applyApprovedTaxonomy(f.current,f.plan,f.source,'2026-10-29'),/exceeds approved/);
});
