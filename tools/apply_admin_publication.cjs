const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..');
const context = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(root,'admin/apps-script/Domain.gs'),'utf8'),context);
const domain = context.module.exports;
const allowed = require('../config/functions.json').allowed_functions;
const PUBLIC_FIELDS = ['id','name','category','state','city','functions','grains','address','phone','email','url','status','sources','location','locations'];
const digest = value => createHash('sha256').update(value).digest('hex');

function applyPublication(current, input, requestId) {
  if (!input || Object.keys(input).sort().join(',')!=='removals,requestId,upserts') throw new Error('Unexpected publication payload fields');
  if (!/^[a-f0-9-]{36}$/.test(requestId) || input.requestId !== requestId) throw new Error('Publication request ID mismatch');
  if (!Array.isArray(input.upserts)||!Array.isArray(input.removals)||input.upserts.length+input.removals.length!==1) throw new Error('A publication must contain one reviewed record');
  const records = new Map(current.organizations.map(o=>[o.id,o]));
  for (const id of input.removals) {
    if (!/^grain-[a-f0-9]{16}$/.test(id)) throw new Error('Invalid removal ID');
    records.delete(id);
  }
  for (const record of input.upserts) {
    if (!/^grain-[a-f0-9]{16}$/.test(record.id) || Object.keys(record).some(k=>!PUBLIC_FIELDS.includes(k))) throw new Error('Private or invalid fields in admin publication');
    if(record.locations)for(const branch of record.locations)if(Object.keys(branch).some(k=>!['id','name','type','state','city','functions','grains','address','phone','email','url','sources','operationalStatus','location'].includes(k)))throw new Error('Private or invalid location fields');
    const normalized = domain.normalize({...record,locationChecked:true,...(record.locations?{locations:record.locations.map(l=>({...l,locationChecked:true}))}:{})},allowed);
    domain.assertPublish(normalized,[...records.values()].map(o=>({...o,recordId:o.id})),record.id);
    const clean = JSON.parse(JSON.stringify(domain.toPublic(normalized,record.id,record.status)));
    if (Object.keys(clean).length!==(record.locations?PUBLIC_FIELDS.length:PUBLIC_FIELDS.length-1)) throw new Error('Incomplete public record');
    records.set(record.id,clean);
  }
  if (!records.size) throw new Error('Refusing to publish an empty directory');
  const organizations = [...records.values()].sort((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase())||a.state.localeCompare(b.state));
  return {...current,generated:new Date().toISOString().slice(0,10),organizations,summary:{total:organizations.length,mapped:organizations.filter(o=>o.location).length,verified:organizations.filter(o=>o.status==='Verified').length}};
}

if (require.main===module) {
  const raw=process.env.ADMIN_PUBLICATION || '';
  if (Buffer.byteLength(raw)>60000) throw new Error('Publication request too large');
  const input=JSON.parse(raw), currentPath=path.join(root,'data/organizations.json');
  const current=JSON.parse(fs.readFileSync(currentPath,'utf8'));
  const next=applyPublication(current,input,process.env.ADMIN_REQUEST_ID);
  fs.writeFileSync(currentPath,JSON.stringify(next));
  console.log(`Prepared one reviewed admin publication (${digest(raw).slice(0,12)}).`);
}
module.exports={applyPublication};
