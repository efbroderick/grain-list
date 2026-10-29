const fs=require('node:fs');
const path=require('node:path');
const {buildAdmin}=require('./build_admin.cjs');
const root=path.join(__dirname,'..'), destination=path.join(root,'.maintenance/admin-app');
buildAdmin();
fs.mkdirSync(destination,{recursive:true});
for(const name of ['Code.gs','Domain.gs','Schema.html','Index.html','Client.html','Styles.html','appsscript.json'])fs.copyFileSync(path.join(root,'admin/apps-script',name),path.join(destination,name));
console.log('Admin code prepared in .maintenance/admin-app. Existing clasp connection preserved.');
