const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
function buildAdmin() {
  const schema=JSON.stringify(JSON.parse(fs.readFileSync(path.join(root,'config/functions.json'),'utf8')));
  fs.writeFileSync(path.join(root,'admin/apps-script/Schema.html'),schema);
}
if(require.main===module)buildAdmin();
module.exports={buildAdmin};
