// Applies an explicitly approved cell plan, not a wholesale Sheet import.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const context={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin/apps-script/Domain.gs'),'utf8'),context);
const domain=context.module.exports;
const split=value=>String(value||'').split(/[,;\n]/).map(s=>s.trim()).filter(Boolean);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function applyApprovedTaxonomy(current,plan,source,date) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw new Error('Supply the reviewed publication date.');
  if(!Array.isArray(plan.approvedGroups)||[...plan.approvedGroups].sort().join(',')!=='A,B,C,D')throw new Error('This release requires explicit approval of groups A-D.');
  if(!Array.isArray(plan.changes)||!plan.changes.length||!Array.isArray(source.records)||!Array.isArray(current.organizations))throw new Error('Incomplete approved plan or source.');
  const master=new Map(source.records.map(r=>[r.recordId,r]));
  const records=new Map(current.organizations.map(o=>[o.id,JSON.parse(JSON.stringify(o))]));
  if(master.size!==source.records.length||records.size!==current.organizations.length)throw new Error('Repeated source or public ID.');
  const changed=[],seen=new Set();
  for(const c of plan.changes){
    if(!['category','grains'].includes(c.field)||typeof c.before!=='string'||typeof c.proposed!=='string'||!c.approvalGroups?.length||c.approvalGroups.some(g=>!plan.approvedGroups.includes(g)))throw new Error('Unapproved field or change.');
    const row=master.get(c.recordId),key=c.recordId+'|'+c.field;
    if(seen.has(key))throw new Error('Repeated planned cell.');seen.add(key);
    if(!row||row[c.field]!==c.proposed)throw new Error('Master Sheet no longer matches approved change: '+c.name);
    const id=row.publicId||row.recordId,record=records.get(id);
    if(!record||c.publicId!==id)throw new Error('Approved public identity is missing or changed: '+c.name);
    const canonical=c.field==='category'?domain.category(c.before):[...domain.grains(c.before)].filter(g=>!domain.taxonomy.disallowed_grains.includes(g.toLowerCase()));
    const before=c.field==='grains'?split(c.before):c.before,after=c.field==='grains'?split(c.proposed):c.proposed;
    if(!same(canonical,after))throw new Error('Proposal exceeds approved alias mappings: '+c.name);
    if(!same(record[c.field],before)&&!same(record[c.field],after))throw new Error('Published value changed since review: '+c.name);
    if(!same(record[c.field],after)){record[c.field]=after;changed.push({id,field:c.field,before,after});}
  }
  return {payload:{...current,generated:date,organizations:current.organizations.map(o=>records.get(o.id))},changes:changed};
}
if(require.main===module){
  const args=process.argv.slice(2),get=key=>{const i=args.indexOf(key);if(i<0||!args[i+1])throw new Error('Missing '+key);return args[i+1];};
  const paths=['--published','--plan','--source','--output','--report'].map(get);
  if(new Set(paths.map(p=>path.resolve(p))).size!==paths.length)throw new Error('Inputs, candidate, and report must be separate files.');
  const [published,plan,source,output,report]=paths;
  const result=applyApprovedTaxonomy(JSON.parse(fs.readFileSync(published)),JSON.parse(fs.readFileSync(plan)),JSON.parse(fs.readFileSync(source)),get('--date'));
  fs.writeFileSync(output,JSON.stringify(result.payload));fs.writeFileSync(report,JSON.stringify({changedCells:result.changes.length,changes:result.changes},null,2)+'\n');
  console.log(`Prepared ${result.changes.length} approved category/grain changes; ${result.payload.organizations.length} public records retained.`);
}
module.exports={applyApprovedTaxonomy};
