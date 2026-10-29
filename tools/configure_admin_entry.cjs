const fs=require('node:fs');
const path=require('node:path');
const url=process.argv[2]||'';
if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))throw new Error('Provide the deployed private Google Apps Script /exec URL, not the editor or /dev URL.');
fs.writeFileSync(path.join(__dirname,'../config/admin.json'),JSON.stringify({url},null,2)+'\n');
console.log('Public /admin/ entry configured. No secrets are stored in this configuration.');
