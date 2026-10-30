const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
function buildAdmin() {
  const schema=JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'config/functions.json'),'utf8')));
  fs.writeFileSync(path.join(root,'admin/apps-script/Schema.html'),schema);
  const domainPath=path.join(root,'admin/apps-script/Domain.gs');
  const domain=fs.readFileSync(domainPath,'utf8');
  const taxonomy=JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'config/taxonomy.json'),'utf8')));
  const marker=/\/\* BEGIN_APPROVED_TAXONOMY \*\/[\s\S]*?\/\* END_APPROVED_TAXONOMY \*\//g;
  if([...domain.matchAll(marker)].length!==1)throw new Error('Missing or repeated taxonomy generation marker.');
  fs.writeFileSync(domainPath,domain.replace(marker,()=>`/* BEGIN_APPROVED_TAXONOMY */ ${taxonomy} /* END_APPROVED_TAXONOMY */`));
}
if(require.main===module)buildAdmin();
module.exports={buildAdmin};
